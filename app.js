"use strict";

let gl, canvas;
let pwgl = {};
pwgl.ongoingImageLoads = [];
pwgl.listOfPressedKeys = []; // user input의 동시입력을 처리하기 위해, 각 Key들의 입력여부를 저장해둘 배열

function createGLContext(canvas) {
  const names = ["webgl", "experimental-webgl"];
  let context = null;

  for (let i = 0; i < names.length; i++) {
    try {
      context = canvas.getContext(names[i]);
    } catch (error) {}

    if (context) {
      break;
    }
  }

  if (context) {
    // 예제 원문에서 사용하는 코드는 안티패턴이므로 작성하지 않도록 함.
  } else {
    alert("Failed to create WebGL context!");
  }

  return context;
}

function loadShaderFromDOM(id) {
  const shaderScript = document.getElementById(id);

  if (!shaderScript) {
    return null;
  }

  let shaderSource = "";
  let currentChild = shaderScript.firstChild;
  while (currentChild) {
    if (currentChild.nodeType === 3) {
      shaderSource += currentChild.textContent;
    }
    currentChild = currentChild.nextSibling;
  }

  let shader;
  if (shaderScript.type === "x-shader/x-fragment") {
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  } else if (shaderScript.type === "x-shader/x-vertex") {
    shader = gl.createShader(gl.VERTEX_SHADER);
  } else {
    return null;
  }

  gl.shaderSource(shader, shaderSource);
  gl.compileShader(shader);

  if (
    !gl.getShaderParameter(shader, gl.COMPILE_STATUS) &&
    !gl.isContextLost()
  ) {
    alert(gl.getShaderInfoLog(shader));
    return null;
  }

  return shader;
}

function setupShaders() {
  const vertexShader = loadShaderFromDOM("shader-vs");
  const fragmentShader = loadShaderFromDOM("shader-fs");

  const shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (
    !gl.getProgramParameter(shaderProgram, gl.LINK_STATUS) &&
    !gl.isContextLost()
  ) {
    alert("Failed to setup shaders");
  }

  gl.useProgram(shaderProgram);

  // gl.getAttribLocation()을 이용해서 셰이더 내의 애트리뷰트 변수들의 제네릭 애트리뷰트 인덱스를 받아온 뒤, 전역 객체인 pwgl에 저장함. (컨텍스트 상실 고려)
  pwgl.vertexPositionAttributeLoc = gl.getAttribLocation(
    shaderProgram,
    "aVertexPosition"
  );
  pwgl.vertexTextureAttributeLoc = gl.getAttribLocation(
    shaderProgram,
    "aTextureCoordinates"
  );

  // gl.getUniformLocation()을 이용해서 셰이더 내의 유니폼 변수들의 WebGLUniformLocation 객체를 받아온 뒤, 전역 객체인 pwgl에 저장함. (컨텍스트 상실 고려)
  pwgl.uniformMVMatrixLoc = gl.getUniformLocation(shaderProgram, "uMVMatrix");
  pwgl.uniformProjMatrixLoc = gl.getUniformLocation(shaderProgram, "uPMatrix");
  pwgl.uniformSamplerLoc = gl.getUniformLocation(shaderProgram, "uSampler");

  // 버텍스 좌표 데이터와 각 버텍스에 해당하는 텍스쳐 좌표 데이터를 쏴줄 각 애트리뷰트 변수들을 활성화함.
  // 왜냐면, 얘내들은 상수 버텍스 데이터가 아니라 WebGLBuffer에 기록된 데이터 배열로 쏴줄거니까
  gl.enableVertexAttribArray(pwgl.vertexPositionAttributeLoc);
  gl.enableVertexAttribArray(pwgl.vertexTextureAttributeLoc);

  // 모델뷰행렬, 투영행렬을 위한 4*4 빈 행렬 및 모델뷰행렬 스택을 만들어 둠
  pwgl.modelViewMatrix = mat4.create();
  pwgl.projectionMatrix = mat4.create();
  pwgl.modelViewMatrixStack = [];
}

function setupFloorBuffers() {
  // gl.drawElements()로 바닥을 그릴 때 사용할 버텍스 위치 데이터 WebGLBuffer 생성
  pwgl.floorVertexPositionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.floorVertexPositionBuffer);

  const floorVertexPosition = [
    // y좌표값(높이)가 0인 4개의 버텍스 좌표를 기록해 둠.
    5.0,
    0.0,
    5.0, //v0
    5.0,
    0.0,
    -5.0, //v1
    -5.0,
    0.0,
    -5.0, //v2
    -5.0,
    0.0,
    5.0, // v3
  ]; // 버텍스 셰이더에서 투영 변환하여 클립좌표(-1.0 ~ 1.0)로 변환해 줌. 굳이 버텍스 데이터를 클립좌표로 안넣어도 됨.

  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(floorVertexPosition),
    gl.STATIC_DRAW
  );

  pwgl.FLOOR_VERTEX_POS_BUF_ITEM_SIZE = 3; // 버텍스 하나 당 필요한 좌표값 수
  pwgl.FLOOR_VERTEX_POS_BUF_NUM_ITEMS = 4; // 총 버텍스 수

  // 바닥을 그릴 때 각 버텍스마다 사용할 텍스처 좌표값을 저장해 둘 WebGLBuffer 생성
  pwgl.floorVertexTextureCoorinateBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.floorVertexTextureCoorinateBuffer);

  const floorVertexTextureCoordinates = [
    2.0,
    0.0, // v0
    2.0,
    2.0, // v1
    0.0,
    2.0, // v2
    0.0,
    0.0, // v3
  ]; // 각 버텍스에 할당될 텍스처 좌표가 (0.0, 0.0) ~ (1.0, 1.0) 범위를 벗어남. -> 텍스처 래핑으로 처리되겠군

  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(floorVertexTextureCoordinates),
    gl.STATIC_DRAW
  );

  pwgl.FLOOR_VERTEX_TEX_COORD_BUF_ITEM_SIZE = 2; // 버텍스 하나 당 필요한 텍스처 좌표값 수
  pwgl.FLOOR_VERTEX_TEX_COORD_BUF_NUM_ITEMS = 4; // 총 버텍스 수

  // gl.drawElements()로 바닥을 그릴 때 사용할 버텍스 인덱스를 기록할 WebGLBuffer 생성
  pwgl.floorVertexIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pwgl.floorVertexIndexBuffer);

  const floorVertexIndices = [0, 1, 2, 3];

  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(floorVertexIndices),
    gl.STATIC_DRAW
  );

  pwgl.FLOOR_VERTEX_INDEX_BUF_ITEM_SIZE = 1; // 버텍스 하나를 가리키는 인덱스 수. 딱히 예제에서 사용 안함.
  pwgl.FLOOR_VERTEX_INDEX_BUF_NUM_ITEMS = 4; // 총 인덱스 수
}

function setupCubeBuffers() {
  // 큐브의 버텍스 위치 데이터를 담을 WebGLBuffer 생성
  pwgl.cubeVertexPositionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.cubeVertexPositionBuffer);

  const cubeVertexPosition = [
    // Front face
    1.0,
    1.0,
    1.0, //v0
    -1.0,
    1.0,
    1.0, //v1
    -1.0,
    -1.0,
    1.0, //v2
    1.0,
    -1.0,
    1.0, //v3

    // Back face
    1.0,
    1.0,
    -1.0, //v4
    -1.0,
    1.0,
    -1.0, //v5
    -1.0,
    -1.0,
    -1.0, //v6
    1.0,
    -1.0,
    -1.0, //v7

    // Left face
    -1.0,
    1.0,
    1.0, //v8
    -1.0,
    1.0,
    -1.0, //v9
    -1.0,
    -1.0,
    -1.0, //v10
    -1.0,
    -1.0,
    1.0, //v11

    // Right face
    1.0,
    1.0,
    1.0, //12
    1.0,
    -1.0,
    1.0, //13
    1.0,
    -1.0,
    -1.0, //14
    1.0,
    1.0,
    -1.0, //15

    // Top face
    1.0,
    1.0,
    1.0, //v16
    1.0,
    1.0,
    -1.0, //v17
    -1.0,
    1.0,
    -1.0, //v18
    -1.0,
    1.0,
    1.0, //v19

    // Bottom face
    1.0,
    -1.0,
    1.0, //v20
    1.0,
    -1.0,
    -1.0, //v21
    -1.0,
    -1.0,
    -1.0, //v22
    -1.0,
    -1.0,
    1.0, //v23
  ]; // 1.0 ~ -1.0 사이의 좌표값만 넣어줬지만, 이거는 클립좌표 기준으로 넣어준 게 절대 아님!! -> 즉, 버텍스 셰이더에서 투명 변환 해줘서 이 값들이 더 작은 값으로 변할거라는 뜻!

  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(cubeVertexPosition),
    gl.STATIC_DRAW
  );

  pwgl.CUBE_VERTEX_POS_BUF_ITEM_SIZE = 3; // 버텍스 하나 당 필요한 좌표값 수
  pwgl.CUBE_VERTEX_POS_BUF_NUM_ITEMS = 24; // 총 버텍스 수 (큐브는 꼭지점 하나 당 3면이 이웃하고, 각 면마다 서로 다른 버텍스 데이터를 넘겨주고 싶기 때문에 8개의 꼭지점 * 3면 = 24개가 나온 것)

  // 큐브에서 사용할 텍스처 좌표 데이터를 담는 WebGLBuffer 생성
  pwgl.cubeVertexTextureCoordinateBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.cubeVertexTextureCoordinateBuffer);

  const textureCoordinates = [
    //Front face
    0.0,
    0.0, //v0
    1.0,
    0.0, //v1
    1.0,
    1.0, //v2
    0.0,
    1.0, //v3

    // Back face
    0.0,
    1.0, //v4
    1.0,
    1.0, //v5
    1.0,
    0.0, //v6
    0.0,
    0.0, //v7

    // Left face
    0.0,
    1.0, //v8
    1.0,
    1.0, //v9
    1.0,
    0.0, //v10
    0.0,
    0.0, //v11

    // Right face
    0.0,
    1.0, //v12
    1.0,
    1.0, //v13
    1.0,
    0.0, //v14
    0.0,
    0.0, //v15

    // Top face
    0.0,
    1.0, //v16
    1.0,
    1.0, //v17
    1.0,
    0.0, //v18
    0.0,
    0.0, //v19

    // Bottom face
    0.0,
    1.0, //v20
    1.0,
    1.0, //v21
    1.0,
    0.0, //v22
    0.0,
    0.0, //v23
  ]; // 0.0 ~ 1.0 사이의 텍스처 좌표값만 사용하는 것으로 보아, 래핑은 안하겠군. 오브젝트와 카메라의 위치에 따라 텍스처 확대 또는 축소가 되겠군.

  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(textureCoordinates),
    gl.STATIC_DRAW
  );

  pwgl.CUBE_VERTEX_TEX_COORD_BUF_ITEM_SIZE = 2; // 버텍스 하나 당 필요한 텍스처 좌표 수
  pwgl.CUBE_VERTEX_TEX_COORD_BUF_NUM_ITEMS = 24; // 총 버텍스 수 (버텍스마다 각기 다른 텍스처 좌표 데이터를 쏴줄거니까 총 버텍스 수와 같아야지)

  // gl.drawElements() 메서드로 큐브를 그릴 때 사용할 버텍스 인덱스를 기록할 WebGLBuffer 생성
  pwgl.cubeVertexIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pwgl.cubeVertexIndexBuffer);

  const cubeVertexIndices = [
    0,
    1,
    2,
    0,
    2,
    3, // Front face
    4,
    6,
    5,
    4,
    7,
    6, // Back face
    8,
    9,
    10,
    8,
    10,
    11, // Left face
    12,
    13,
    14,
    12,
    14,
    15, // Right face
    16,
    17,
    18,
    16,
    18,
    19, // Top face
    20,
    22,
    21,
    20,
    23,
    22, // Bottom face
  ];

  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(cubeVertexIndices),
    gl.STATIC_DRAW
  );

  pwgl.CUBE_VERTEX_INDEX_BUF_ITEM_SIZE = 1; // 버텍스 하나 당 인덱스 수
  pwgl.CUBE_VERTEX_INDEX_BUF_NUM_ITEMS = 36; // 총 인덱스 수 (24개의 버텍스를 36번의 인덱스 호출하여 큐브를 만듦.)
}

function setupBuffers() {
  setupFloorBuffers();
  setupCubeBuffers();
}

// 텍스처 바인딩, GPU에 이미지 데이터 전송 등 텍스처 사용에 필요한 나머지 작업을 처리하는 함수
function textureFinishedLoading(image, texture) {
  // gl.bindBuffer()와 마찬가지로, 'WebGL이 지금부터 이 텍스처 객체를 사용할 겁니다' 라고 지정함.
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // 텍스처 데이터(이미지 객체)를 GPU로 전송하기 전, 이미지를 Y축 방향으로 뒤집어 줌.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  // 축소 필터에서 밉맵 체인이 필요한 텍스처 필터링 방법 사용 시 밉맵 체인을 자동생성 해둬야 함. 근데 여기서는 밉맵이 필요한 필터링을 딱히 안쓰고 있긴 함.
  gl.generateMipmap(gl.TEXTURE_2D);

  // 텍스처 필터링 방법 지정
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // 텍스처 확대 시 필터링 방법 지정
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); //  텍스처 축소 시 필터링 방법 지정

  // 텍스처 래핑 방법 지정 -> 이 예제에서는 floor에 사용될 텍스처가 래핑될거임. (애트리뷰트 변수에 쏴주는 텍스처 좌표 데이터를 보면 알 수 있음.)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); // 가로 방향 래핑 모드 지정
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT); // 세로 방향 래핑 모드 지정

  // 3개의 WebGLTexture 객체를 반복해서 처리해줘야 하므로, 다음 텍스처 객체 바인딩 전,
  // 마지막 줄에서 null을 바인딩해 초기화함.
  gl.bindTexture(gl.TEXTURE_2D, null);
}

// WebGLTexture 객체 사용 시 GPU에 전송할 Image 객체를 만들어주는 함수
function loadImageForTexture(url, texture) {
  const image = new Image();
  image.onload = function () {
    pwgl.ongoingImageLoads.splice(pwgl.ongoingImageLoads.indexOf(image), 1); // 로딩을 무사히 마친 이미지객체는 pwgl.ongoingImageLoads 배열에서 splice로 제거함.
    textureFinishedLoading(image, texture); // 텍스처 바인딩, 데이터 전송 등 텍스처 사용에 필요한 나머지 작업을 처리하는 함수 호출
  };
  pwgl.ongoingImageLoads.push(image); // 이미지 로딩 전, 로딩이 진행중인 이미지객체를 모아두는 배열에 담아놓음.
  image.src = url; // 전달받은 url을 할당하여 이미지를 비동기로 로드함.
}

// 텍스처 객체(WebGLTexture)들을 생성하는 함수
function setupTextures() {
  // 테이블 텍스처 객체
  pwgl.woodTexture = gl.createTexture();
  loadImageForTexture("wood_128x128.jpg", pwgl.woodTexture); // WebGLTexture 객체를 생성 후, 텍스처 사용에 필요한 이미지 객체를 만들어주는 함수 호출.

  // 바닥 텍스처 객체
  pwgl.groundTexture = gl.createTexture();
  loadImageForTexture("wood_floor_256.jpg", pwgl.groundTexture);

  // 테이블 위 상자 텍스처 객체
  pwgl.boxTexture = gl.createTexture();
  loadImageForTexture("wicker_256.jpg", pwgl.boxTexture);
}

function uploadModelViewMatrixToShader() {
  // gl.uniformMatrix4fv() 메서드로 버텍스 셰이더의 uMVMatrix 유니폼 변수에 modelViewMatrix를 업로드함.
  gl.uniformMatrix4fv(pwgl.uniformMVMatrixLoc, false, pwgl.modelViewMatrix);
}

function uploadProjectionMatrixToShader() {
  // gl.uniformMatrix4fv() 메서드로 버텍스 셰이더의 uPMatrix 유니폼 변수에 modelViewMatrix를 업로드함.
  gl.uniformMatrix4fv(pwgl.uniformProjMatrixLoc, false, pwgl.projectionMatrix);
}

// 바닥을 그리는 함수
function drawFloor() {
  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.floorVertexPositionBuffer);
  gl.vertexAttribPointer(
    pwgl.vertexPositionAttributeLoc,
    pwgl.FLOOR_VERTEX_POS_BUF_ITEM_SIZE,
    gl.FLOAT,
    false,
    0,
    0
  ); // pwgl.floorVertexPositionBuffer에 기록된 버텍스 데이터를 aVertexPosition으로 가져올 방법을 정의함.

  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.floorVertexTextureCoorinateBuffer); // 이번에는 텍스처 좌표 데이터가 담긴 WebGLBuffer에서 버텍스 데이터를 가져오겠군.
  gl.vertexAttribPointer(
    pwgl.vertexTextureAttributeLoc,
    pwgl.FLOOR_VERTEX_TEX_COORD_BUF_ITEM_SIZE,
    gl.FLOAT,
    false,
    0,
    0
  ); // pwgl.floorVertexTextureCoordinateBuffer에 기록된 각 버텍스별 텍스처 좌표 데이터를 aTextureCoordinates 로 가져올 방법을 정의함.

  gl.activeTexture(gl.TEXTURE0); // draw() 함수에서 지정해 준 텍스처 이미지 유닛을 사용하도록 명령하는 메서드
  gl.bindTexture(gl.TEXTURE_2D, pwgl.groundTexture); // 해당 텍스처 이미지 유닛에 바인딩하려는 WebGLTexture 객체를 전달함.

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pwgl.floorVertexIndexBuffer); // gl.drawElements() 메서드가 엘레먼트 배열 버퍼를 사용하려면, 먼저 해당 WebGLBuffer를 바인딩해줘야 함.
  gl.drawElements(
    gl.TRIANGLE_FAN,
    pwgl.FLOOR_VERTEX_INDEX_BUF_NUM_ITEMS,
    gl.UNSIGNED_SHORT,
    0
  );
}

function pushModelViewMatrix() {
  // 현재의 모델뷰행렬을 복사한 뒤, 복사본을 모델뷰행렬 스택에 push해놓는 함수
  const copyToPush = mat4.create(pwgl.modelViewMatrix);
  pwgl.modelViewMatrixStack.push(copyToPush);
}

// 가장 최근에 스택에 저장된 모델뷰행렬을 가져와 현재의 모델뷰행렬로 복구시키는 함수.
function popModelViewMatrix() {
  if (pwgl.modelViewMatrixStack.length === 0) {
    // 만약 모델뷰행렬 스택이 비어있다면, 에러 메시지를 생성하고 프로그램을 중단함.
    // -> why? throw 연산자는 try...catch 블록 내에서 사용되지 않으면 예외 발생 시 스크립트가 죽어버림.
    throw "Error popModelViewMatrix() - Stack was empty";
  }

  // pop() 메서드는 가장 마지막 item을 리턴해줌과 동시에 스택에서 마지막 item을 자동으로 제거해 줌.
  pwgl.modelViewMatrix = pwgl.modelViewMatrixStack.pop();
}

// 변형된 모델뷰행렬을 적용해서 다양한 크기와 모양의 큐브를 그리는 함수
function drawCube(texture) {
  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.cubeVertexPositionBuffer); // gl.vertexAttribPointer()로 어떤 WebGLBuffer에서 버텍스 데이터를 가져갈건지 정하기 위한 바인딩.
  gl.vertexAttribPointer(
    pwgl.vertexPositionAttribLoc,
    pwgl.CUBE_VERTEX_POS_BUF_ITEM_SIZE,
    gl.FLOAT,
    false,
    0,
    0
  ); // cubeVertexPositionBuffer에 기록된 버텍스 데이터를 aVertexPosition으로 가져올 방법을 정의함.

  gl.bindBuffer(gl.ARRAY_BUFFER, pwgl.cubeVertexTextureCoordinateBuffer); // 이번에는 텍스처 좌표 데이터가 담긴 WebGLBuffer에서 버텍스 데이터를 가져오겠군.
  gl.vertexAttribPointer(
    pwgl.vertexTextureAttributeLoc,
    pwgl.CUBE_VERTEX_TEX_COORD_BUF_ITEM_SIZE,
    gl.FLOAT,
    false,
    0,
    0
  ); // pwgl.cubeVertexTextureCoordinateBuffer에 기록된 각 버텍스별 텍스처 좌표 데이터를 aTextureCoordinates 로 가져올 방법을 정의함.

  gl.activeTexture(gl.TEXTURE0); // draw() 함수에서 지정해 준 텍스처 이미지 유닛을 사용하도록 명령하는 메서드
  gl.bindTexture(gl.TEXTURE_2D, texture); // 해당 텍스처 이미지 유닛에 바인딩하려는, 인자로 전달받은 WebGLTexture 객체를 전달함.

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pwgl.cubeVertexIndexBuffer); // gl.drawElements() 메서드가 엘레먼트 배열 버퍼를 사용하려면, 먼저 해당 WebGLBuffer를 바인딩해줘야 함.

  gl.drawElements(
    gl.TRIANGLES,
    pwgl.CUBE_VERTEX_INDEX_BUF_NUM_ITEMS,
    gl.UNSIGNED_SHORT,
    0
  );
}

function drawTable() {
  // 테이블 윗면 그리기
  pushModelViewMatrix(); // draw() 함수에서 이동변환이 적용된 모델뷰행렬을 또 저장함. -> drawTable() 함수 안에서만 계속 복구해서 사용할거임.
  mat4.translate(pwgl.modelViewMatrix, [0.0, 1.0, 0.0], pwgl.modelViewMatrix); // y축으로 올려주는 이동변환 적용
  mat4.scale(pwgl.modelViewMatrix, [2.0, 0.1, 2.0], pwgl.modelViewMatrix); // 테이블 윗면은 얇으면서 넓은 모양이 되도록 스케일 변환 적용
  uploadModelViewMatrixToShader(); // 모델뷰행렬이 바뀌면 버텍스 셰이더에 재업로드
  drawCube(pwgl.woodTexture); // 인자로 전달해 준 WebGLTexture 객체를 바인딩해서 큐브를 그려주는 함수
  popModelViewMatrix(); // 함수 첫번째 줄에서 저장해뒀던 모델뷰행렬을 다시 꺼내와서 복구시킴.

  // 테이블 다리 그리기
  for (let i = -1; i <= 1; i += 2) {
    for (let j = -1; j <= 1; j += 2) {
      pushModelViewMatrix(); // 함수 첫번째 줄에서 저장했다가 다시 복구한 모델뷰행렬을 다시 스택에 저장해 둠.
      mat4.translate(
        pwgl.modelViewMatrix,
        [i * 1.9, -0.1, j * 1.9],
        pwgl.modelViewMatrix
      ); // 각 다리의 버텍스들을 y축으로 -0.1만큼 내리고, XZ축을 기준으로 -1.9 ~ 1.9 사이의 좌표값을 지정하도록 이동 변환 적용.
      mat4.scale(pwgl.modelViewMatrix, [0.1, 1.0, 0.1], pwgl.modelViewMatrix); // y축으로 길쭉한 모양이 되도록 XZ축 기준으로 0.1배 스케일링 변환 적용.
      uploadModelViewMatrixToShader(); // 모델뷰행렬이 바뀌면 버텍스 셰이더에 재업로드
      drawCube(pwgl.woodTexture); // 위에서 사용한 WebGLTexture와 동일한 텍스처로 큐브를 그려줌. (테이블 윗면과 테이블 다리는 같은 재질이니 텍스처도 동일하게 적용해야지!)
      popModelViewMatrix(); // 다음 반복문 넘어가서 새로운 다리를 그리기 전, 현재의 모델뷰행렬을 push해놓은 행렬(draw() 함수에서 y축으로 1.1만큼 이동시킨 거)로 복구함.
    }
  }

  /**
   * 여기서 기억할 점은,
   * 마지막 반복문에서 마지막 다리를 그려준 뒤,
   * popModelViewMatrix(); 해버리게 되면,
   *
   * 현재의 모델뷰 행렬은 draw() 함수에서 y축으로 1.1만큼 이동시킨 모델뷰 행렬로 복구되고,
   * 스택에는 카메라의 뷰 변환만 적용된 모델뷰 행렬만 남게 됨.
   *
   * 또 draw() 함수에서 drawTable() 호출하고 난 뒤,
   * popModelViewMatrix() 를 호출해버리면,
   * 결과적으로 현재 모델뷰행렬에는 뷰 변환만 적용된 모델뷰행렬로 복구가 될것임!
   * -> 여기서부터 다시 시작해서 모델뷰변환을 적용한 다음 테이블 위 큐브를 그리려는 것
   */
}

function draw(currentTime) {
  pwgl.requestId = requestAnimFrame(draw); // 다음 애니메이션 호출 예약을 위해 내부에서 반복 호출. -> 원래 이런거는 렌더링 함수의 끝부분에 해주는 게 좋음. 예제에서 첫 줄에 해줬으니 일단 그대로 해보자.

  if (currentTime === undefined) {
    // 원래 DOMHighResTimeStamp 값은 최초 호출 시(즉, 첫 번째 프레임), undefined로 전달되게 되어있음.
    // 그런데 하단의 코드를 보면 알겠지만, pwgl.x, y, z 값 모두 currentTime를 이용해서 계산하는데,
    // 숫자 계산에 undefined가 끼어있으면 결과값이 NaN(Not a Number)로 나와버림.
    // 이 값을 행렬변환에 필요한 좌표값으로 넣어줄 수 없기 때문에 undefined로 전달받은 타임스탬프값을 0으로 넣어주려는 것.
    currentTime = 0;

    /**
     * 책과 코드 원문에서는 저 값은 Date.now() 로 줬는데,
     * 상식적으로 저 값은 1970년 1월 1일 이후 현재까지 흐른 시간을 밀리초 단위로 주는 값인데
     *
     * 저 값을 currentTime 값으로 주면 애니메이션 계산에 문제가 생김.
     *
     * 원문 코드대로 실행해보면 알겠지만, 애니메이션 자체가 안보일 뿐더러,
     * 테이블 위 상자 자체가 안보이게 되어버림.
     *
     * 아마 원문코드는 맨 처음에는 애니메이션을 작동시키지 못하도록 저 값을 준 것 같고,
     * 애니메이션을 실제로 작동시키려면 저 값은 0으로 주는 것이 적당함.
     */
  }

  // 매 프레임마다 위/아래 화살표 방향키 입력 여부를 체크한 뒤 회전 반경을 조절해 줌.
  handlePressedDownKeys();

  // 1000ms(1초)가 지났을 때마다 프레임 카운팅을 초기화하고, pwgl.previousFrameTimeStamp 값도 다음 1초를 세기 시작하는 시점의 타임스탬프값으로 갱신해줌.
  if (currentTime - pwgl.previousFrameTimeStamp >= 1000) {
    pwgl.fpsCounter.innerHTML = pwgl.nbrOfFramesForFPS; // 방금 지난 1초 동안 그려온 프레임 수를 화면에 찍어줌.
    pwgl.nbrOfFramesForFPS = 0; // 프레임 수 카운터를 0으로 초기화 -> 다음 1초 동안의 프레임 수를 다시 카운트하기 위해서!
    pwgl.previousFrameTimeStamp = currentTime; // 조건문에서 1초가 지났는지 체크하기 위해, 1초 단위로 이전 타임스탬프 값을 1초가 지난 순간의 타임스탬프 값으로 갱신함.
  }

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // 초기 투영행렬을 만듦
  mat4.perspective(
    60,
    gl.canvas.width / gl.canvas.height,
    1,
    100.0,
    pwgl.projectionMatrix
  );

  // 초기 모델뷰행렬을 만듦. (뷰 변환만 적용)
  mat4.identity(pwgl.modelViewMatrix);
  mat4.lookAt([8, 5, 10], [0, 0, 0], [0, 1, 0], pwgl.modelViewMatrix);

  // 투영행렬, 모델뷰행렬을 새로 초기화했으니 버텍스 셰이더에 업로드하는 함수를 호출
  uploadModelViewMatrixToShader();
  uploadProjectionMatrixToShader();

  // 프래그먼트 셰이더의 uSampler 유니폼 변수에 0을 넣어준 뒤, 사용할 텍스처 이미지 유닛을 gl.TEXTURE0 으로 지정함.
  gl.uniform1i(pwgl.uniformSamplerLoc, 0);

  // 바닥을 그리는 함수 호출
  drawFloor();

  // 테이블 그리기
  // 테이블 그리기 전 초기 모델뷰행렬을 스택에 저장해 둠.
  pushModelViewMatrix();
  mat4.translate(pwgl.modelViewMatrix, [0.0, 1.1, 0.0], pwgl.modelViewMatrix);
  uploadModelViewMatrixToShader(); // 모델뷰행렬을 이동변환 하고 난 뒤, 버텍스 셰이더에 재업로드.
  drawTable();
  popModelViewMatrix(); // drawTable() 함수의 마지막 코멘트처럼, 여기서 다시 pop 해주면 현재의 모델뷰행렬은 뷰 변환만 적용된 모델뷰 행렬로 복구됨.

  // 테이블 위 큐브 그리기
  pushModelViewMatrix(); // 뷰 변환만 적용된 모델뷰행렬을 스택에 저장해 둠

  if (pwgl.animationStartTime === undefined) {
    // 이 값이 undefined 라는 것은, 첫 프레임에 호출된 draw라고 보면 됨.
    // 즉, 초기값인 undefined가 할당된 상태라면, 위에서 0으로 값을 초기화한 currentTime 값을 넣어줄 것.
    pwgl.animationStartTime = currentTime;
  }

  // 처음 3초 동안은 상자의 높이값을 2.7 에서 5로 이동시키는 애니메이션을 보여주려는 것.
  if (pwgl.y < 5) {
    // 상자를 수직으로 2.7에서 5로 이동시킴. 이동에 걸리는 시간은 3초.
    // pwgl.animationStartTime = 0 이기 때문에, currentTime이 3000ms에 가까워질 때까지 이 애니메이션이 지속된다는 뜻!
    // 3000을 넘는 순간 pwgl.y값도 5를 넘을 것이기 때문임!
    // 이처럼 프레임 레이트에 관계없이 시간이 지나면 동일한 거리를 이동할 수 있도록 움직임을 보정하는 공식임! 하단 공식 정리 참고
    pwgl.y =
      2.7 + ((currentTime - pwgl.animationStartTime) / 3000) * (5.0 - 2.7);
  } else {
    // 3000ms(3초)가 지나면, 수직으로 이동하는 애니메이션 (if block)은 더 이상 실행하지 않고,
    // 타임스탬프값에 따라 각도값을 변화시켜서 원의 좌표값을 구한 뒤, 회전시키는 애니메이션 (else block)을 계산함.
    // 얘도 2초 동안 pwgl.angle(각도값)을 0 ~ 360도로 바뀌도록 움직임을 보정해준거임.
    // 근데 마지막에 (2 * Math.PI)를 나눈 '나머지'를 왜 계산해준걸까?
    // pwgl.animationStartTime = 0 으로 고정이고, currentTime 값은 계속 증가하게 될텐데,
    // 그럼 currentTime값이 2000을 넘는 순간 360도를 넘어버리게 되잖아?
    // 대신 그렇게 하지 말고, 해당 각도를 2 * Math.PI(360도)로 나눈 나머지값으로 계산해준다면,
    // 0 ~ 360도까지 바뀌고 나면, 그 다음에도 0 ~ 360도로 각도값 순환을 계속 반복시킬 수 있게 되는거임!
    // 물론 여기서 각도값은 2 * Math.PI 로 곱해주기 때문에 실제로는 '라디안' 값으로 계산이 되겠지!
    pwgl.angle =
      (((currentTime - pwgl.animationStartTime) / 2000) * 2 * Math.PI) %
      (2 * Math.PI);

    // 위에서 구한 각도값과 pwgl.circleRadius를 반지름(직각삼각형에서 빗변에 해당)으로 하는 원의 좌표값을 구하는 공식.
    // 이 값으로 이동변환을 만들면 상자의 위치가 매 프레임마다 원을 그리는 궤도를 따라 이동하게 될거임
    pwgl.x = Math.cos(pwgl.angle) * pwgl.circleRadius;
    pwgl.z = Math.sin(pwgl.angle) * pwgl.circleRadius;
  }

  mat4.translate(
    pwgl.modelViewMatrix,
    [pwgl.x, pwgl.y, pwgl.z],
    pwgl.modelViewMatrix
  ); // 위에 if-else block에서 구한 상자의 수직 좌표값(pwgl.y)과 원의 좌표값(pwgl.x, z)로 이동변환을 만들어 줌.
  mat4.scale(pwgl.modelViewMatrix, [0.5, 0.5, 0.5], pwgl.modelViewMatrix); // drawCube() 함수 자체는 모서리가 2인 큐브를 그리므로, scale을 XYZ축 기준 0.5배로 변환 적용하면 모서리가 1인 큐브로 그려지겠군.
  uploadModelViewMatrixToShader(); // 모델뷰행렬이 바뀌었으니 버텍스 셰이더에 재업로드
  drawCube(pwgl.boxTexture); // 이번에는 테이블에서 썼던 것과는 다른 WebGLTexture 사용해서 큐브를 그림
  popModelViewMatrix(); // 현재 모델뷰행렬을 다시 뷰 변환만 적용된 모델뷰행렬로 복구시킴.

  pwgl.nbrOfFramesForFPS++; // 매 프레임이 그려질 때마다 프레임 카운터를 1씩 증가시켜줌
}

// 컨텍스트 상실 발생하면 호출할 이벤트핸들러 함수
function handleContextLost(e) {
  e.preventDefault();
  cancelRequestAnimFrame(pwgl.requestId);

  for (let i = 0; i < pwgl.ongoingImageLoads.length; i++) {
    pwgl.ongoingImageLoads[i].onload = undefined;
  }
  pwgl.ongoingImageLoads = [];
}

// 컨텍스트 복구 시 셰이더, WebGLBuffer, WebGLTexture 등 재설정 해주는 작업을
// 이전 예제에서는 handleContextRestored() 함수에서 바로 처리해줬는데,
// 이 예제에서는 애니메이션 관련 몇가지 초기화를 추가로 처리해야 하므로, 작성해야 하는 코드가 늘어나다보니
// 아예 초기화 관련 작업들을 init() 함수에 따로 모아둔 것. -> 이렇게 하면 startup() 함수에서도 재사용 가능하니 일석이조!
function init() {
  // startup() 함수 또는 컨텍스트 복구 시 WebGL 관련 설정 및 리소스 초기화 작업
  setupShaders();
  setupBuffers();
  setupTextures();
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.enable(gl.DEPTH_TEST);

  // 테이블 위 박스 애니메이션에 필요한 값들 초기화함.
  pwgl.x = 0.0;
  pwgl.y = 2.7;
  pwgl.z = 0.0;
  pwgl.circleRadius = 4.0;
  pwgl.angle = 0;

  // 프레임 레이트에 따른 움직임 보정 및 FPS 카운터 제작에 필요한 값들 초기화
  pwgl.animationStartTime = undefined;
  pwgl.nbrOfFramesForFPS = 0;
  pwgl.previousFrameTimeStamp = 0; // Data.now() 값으로 초기값을 지정하면 애니메이션이 재생될 수가 없음. 내가 임의로 0으로 둠.
}

// 컨텍스트 복구 발생 시 호출할 이벤트핸들러 함수
function handleContextRestored(e) {
  init();
  pwgl.requestId = requestAnimFrame(draw, canvas);
}

function handleKeyDown(e) {
  // keydown 이벤트의 keycode를 인덱스로 삼아, 해당 지점에 true를 할당함
  // 즉, 현재 해당 키가 눌려진 상태임을 기록해 둠. -> 동시 입력을 처리하기 위해 키 입력을 기록해둔 것.
  pwgl.listOfPressedKeys[e.keyCode] = true;

  // keydown 이벤트에서 얻을 수 있는 keycode(어떤 '키'를 물리적으로 눌렀는지)와 charCode(어떤 '문자'를 눌렀는지)에 대한 정보 출력
  // 이 값들은 브라우저마다, 이벤트마다 다르므로, p.304 ~ 307 관련 내용 참고할 것!
  console.log("keydown - keyCode=%d, charCode=%d", e.keyCode, e.charCode);
}

function handleKeyUp(e) {
  // keyup 이벤트의 keycode를 인덱스로 삼아, 해당 지점에 false를 할당함
  // 즉, 현재 해당 키가 눌리지 않은 상태임을 기록해 둠. -> 동시 입력을 처리하기 위해 키 입력을 기록해둔 것.
  pwgl.listOfPressedKeys[e.keyCode] = false;

  console.log("keyup - keyCode=%d, charCode=%d", e.keyCode, e.charCode);
}

function handleKeyPress(e) {
  // keypress 이벤트는 어떤 '문자'가 입력되었는지 알려주는 charCode값은 알 수 있지만,
  // 어떤 '키'가 눌렸는지 알려주는 keyCode값은 브라우저마다 값이 다르기 때문에 이 값을 실제로 사용할 수는 없고,
  // 각각의 값들을 그냥 콘솔로 확인해볼 수 있는 코드만 작성해놓음
  console.log("keypress - keyCode=%d, charCode=%d", e.keyCode, e.charCode);

  /**
   * 참고로 keypress 이벤트는 방향키가 아닌 '문자열 값을 생성하는 키'를 눌렀을 때에만 발생함.
   * 즉, 화살표 키는 눌러봤자 keypress 이벤트가 발생하지 않는다는 뜻.
   *
   * 그런데 keypress 이벤트도 더 이상 사용을 권장하지 않는 이벤트라고 함.
   */
}

function handlePressedDownKeys() {
  // pwgl.listOfPressedKeys 배열안의 boolean 값들을 확인한 뒤,
  // 상방향 화살표 키와 하방향 화살표 키들이 현재 눌린 상태인지 체크하고, 그에 따라 현재 상자의 회전 애니메이션 반경(반지름)값을 조절함.
  // 화살표 방향키에 따른 keyCode값은 p.307 ~ 308 참고.
  if (pwgl.listOfPressedKeys[38]) {
    // 만약 상방향 화살표 키가 true라면, 즉 눌린 상태라면, 회전 반경을 0.1 늘려줌.
    pwgl.circleRadius += 0.1;
  }

  if (pwgl.listOfPressedKeys[40]) {
    // 만약 하방향 화살표 키가 true라면, 즉 눌린 상태라면 회전 반경을 0.1 줄임
    pwgl.circleRadius -= 0.1;

    if (pwgl.circleRadius < 0) {
      // 만약 0.1씩 계속 줄어들다가 회전 반경이 0보다 작아지려고 하면 계속 0으로 초기화함.
      pwgl.circleRadius = 0;
    }
  }

  /**
   * 원래 e.keyCode 값은 더 이상 사용하지 말 것을 권장하고 있는 스펙임.
   *
   * 브라우저에서 작동하지 않는 것은 아니지만, 가급적
   * e.keyCode 대신 e.code 를 사용할 것을 권장하고 있음.
   *
   * e.code는 현재 입력된 키를 나타내는 문자열을 리턴해 줌.
   *
   * 그런데 문자열로 입력 여부를 체크하려면 다른 코드들도 바꿔줘야 하고
   * 좀 번거로우니까 이번 예제에서는 그냥 e.keyCode값을 사용하기로 함.
   */
}

function handleMouseMove(e) {
  // mousemove 이벤트의 좌표값을 확인할 수 있는 이벤트핸들러 함수.
  // 이 값들을 현재 예제에서 사용하지는 않음. 주석처리 해줘도 무방함.
  // console.log("handleMouseMove, clientX=%d, clientY=%d", e.clientX, e.clientY);
}

function handleMouseDown(e) {
  // mousedown 이벤트의 좌표값 및 클릭한 버튼을 확인할 수 있는 이벤트핸들러 함수.
  // 이 값들을 현재 예제에서 사용하지는 않음. 주석처리 해줘도 무방함.
  // console.log(
  // "handleMouseDown, clientX=%d, clientY=%d, button=%d",
  // e.clientX,
  // e.clientY,
  // e.button
  // );
}

function handleMouseUp(e) {
  // mouseup 이벤트의 좌표값 및 클릭한 버튼을 확인할 수 있는 이벤트핸들러 함수.
  // 이 값들을 현재 예제에서 사용하지는 않음. 주석처리 해줘도 무방함.
  // console.log(
  // "handleMouseUp, clientX=%d, clientY=%d, button=%d",
  // e.clientX,
  // e.clientY,
  // e.button
  // );
}

function startup() {
  canvas = document.getElementById("myGLCanvas");
  canvas = WebGLDebugUtils.makeLostContextSimulatingCanvas(canvas);

  // 컨텍스트 상실 및 복구 관련 이벤트핸들러 등록
  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored, false);

  // 키 입력 및 마우스 입력을 처리하는 이벤트핸들러 등록
  document.addEventListener("keydown", handleKeyDown, false);
  document.addEventListener("keyup", handleKeyUp, false);
  document.addEventListener("keypress", handleKeyPress, false);
  document.addEventListener("mousemove", handleMouseMove, false);
  document.addEventListener("mousedown", handleMouseDown, false);
  document.addEventListener("mouseup", handleMouseUp, false);

  gl = createGLContext(canvas);
  init(); // WebGL 관련 설정 및 리소스들, 애니메이션 관련 초기값들을 초기화해주는 함수

  pwgl.fpsCounter = document.getElementById("fps"); // 1초 동안 렌더링된 프레임 수(FPS)를 값으로 넣어서 표시해 줄 요소를 가져옴.

  // 마우스 클릭 시 webglcontextlost 이벤트를 발생시키는 이벤트핸들러. -> 시뮬레이션을 해주고 싶으면 주석 처리를 풀면 됨.
  // window.addEventListener("mousedown", function () {
  //   canvas.loseContext();
  // });

  console.log(Date.now());
  draw();
}

/**
 * 사용자 입력에 대한 이벤트 처리 관련
 *
 * startup() 함수에서 마우스 및 키 입력 이벤트에 대해서 처리하는 이벤트핸들러 함수를 등록할 때,
 * 모든 이벤트들을 DOM 레벨 2 모델 방식의 이벤트 핸들링으로 처리해주고 있음.
 *
 * 또한 세 번째 인자에 false를 전달해줌으로써,
 * DOM 트리 최상위 노드에서 목적지 노드까지 타고 내려가며 이벤트를 전파하는
 * '이벤트 캡쳐링' 단계 실행을 방지하도록 설정함.
 *
 * -> 각 유저 입력 이벤트들에 대해서 이벤트 버블링 단계만 실행되겠지
 */

/**
 * console.log('%d', 정수값이 담긴 매개변수)
 *
 * log() 처럼 문자열을 받는 콘솔 메서드는
 * 여러 개의 치환 문자열을 제공함.
 *
 * 이 때, %d는 정수를 출력해주는 치환 문자열.
 * 이 치환 문자열들은 이후에 나열해 준 매개변수에서 값을 가져옴.
 *
 * 각각의 치환 문자열은 다음의 값들을 출력하는데 사용됨.
 *
 * %o 는 자바스크립트 객체 출력
 * %d 또는 %i 는 정수 출력
 * %s 는 문자열 출력
 * %f 는 부동소수점 수 출력
 */

/**
 * e.button
 *
 * 이거는 마우스의 세 버튼들 중에서 어떤 버튼을 클릭했는지
 * 정수값으로 리턴해서 알려줌.
 *
 * 0 = 마우스 왼쪽 버튼
 * 1 = 마우스 휠 버튼(가운데)
 * 2 = 마우스 오른쪽 버튼
 */

/**
 * 프레임 레이트에 관계없이 움직임 보정 공식 정리
 * 참고로 이 공식은 초기값과 목표값이 분명한 움직임에 적용할 수 있는 공식!
 * -> 예제에서 y좌표값 수직 이동 같은 거
 *
 * 현재 값 = 초기값 + ((현재 타임스탬프(ms) - 시작 타임스탬프(ms) / 지속시간(ms)) * (목표값 - 초기값)
 */

/**
 * draw() 함수에서 첫 프레임 호출 시
 * pwgl.previousFrameTimeStamp 과 currentTime 값을 Date.now()로 초기화했던 이유
 *
 * Date.now() 가 리턴해주는 값은 1970년 1월 1일 이후로 현재까지 흐른 시간을
 * 밀리초 단위로 계산해서 리턴해주게 됨.
 *
 * 그런데 왜 굳이 이 값을 초기값으로 지정하려고 했을까?
 *
 *
 * 1. pwgl.x, y, z값이 NaN로 나올 것이기 때문
 *
 * requestAnimationFrame() 메서드로 반복 호출하게 되는 렌더링 함수는
 * 인자로 타임스탬프값을 받게 되는데, 이 값은 첫 번째 호출에서는 항상 undefined를 받게 되어있음.
 *
 * 그런데 pwgl.y를 구하는 공식만 봐도 알겠지만, 해당 곡식에서 currentTime값을 사용하고 있고,
 * 이 값이 undefined라면 제대로 된 값이 나올 수 있을 리 없겠지.
 *
 * 결과적으로 pwgl.y에는 NaN, 즉 이동변환에 필요한 좌표값으로는 쓸 수 없는 결과값이 리턴되기 때문에
 * 이거를 방지하기 위해 숫자값인 Date.now()의 리턴값을 받고자 했던 것으로 추측됨.
 *
 *
 * 2. 코드를 실행하자마자 애니메이션 및 FPS 카운팅을 작동시키고 싶지 않았기 때문
 *
 * 실제로 코드 원문을 live server로 실행해보면 알겠지만,
 * 애니메이션이 작동하지 않는 것은 둘째치고 상자가 화면에 렌더링조차 되지 않고 있음.
 * 또한 DOM 요소에 출력되는 FPS 카운터조차 제대로 작동하지 않고 있음.
 *
 * 이게 왜 그러냐면, 코드 구조상
 * pwgl.previousFrameTimeStamp, pwgl.animationStartTime, currentTime
 * 요 세 개의 값들이 첫 프레임에서 Date.now() 의 값으로 할당되면
 * 애니메이션이 화면에 보이지도 않고, FPS 카운터도 제대로 작동하지 않게 됨.
 *
 * 그럴 수밖에 없는 게 Date.now()가 리턴해주는 값이
 * 1634151231941 대략 이 정도 사이즈임.
 *
 * 물론 이 값은 밀리초 단위로 계속 갱신되고 있는데,
 * 딱 봐도 저렇게 큰 정수값이 초기값으로 지정되면
 * draw() 함수의 구조상 애니메이션이 화면에 보이지도 않게 되고,
 * FPS 카운터가 제대로 작동하지도 않게 될 수 밖에 없음.
 *
 * 아마 내 추측으로는 처음에 페이지를 열 때는 애니메이션과 FPS 카운팅을 못하게 막아두려고
 * 일부러 저 값을 사용한 것이 아닌가 싶음.
 *
 * 대신 저 값들을 첫 프레임에서 0으로 초기화하여 사용할 수 있다면,
 * 애니메이션도 잘 보이게 되고, FPS 카운터도 정상 작동되는 걸 확인할 수 있음.
 */
