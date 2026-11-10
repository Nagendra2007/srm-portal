import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/* --------------------------------------------------------------------------
   CAPTCHA SOLVER
   A small TFLite model trained on SRM's captcha images. It replaces the old
   Tesseract OCR worker: everything is local (no CDN download, no worker
   thread) and a warm solve takes about 10 ms.

   @tensorflow/tfjs-tflite's own loader only works in a browser (it loads its
   runtime with <script> tags and fetch). Its TFLite WASM runtime runs fine in
   Node though, so we load that runtime directly and skip the browser loader.
   -------------------------------------------------------------------------- */
const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Resolved from this file, not process.cwd(), so it works whether the server
// is started from the repo root or from backend/.
const MODEL_PATH =
  process.env.CAPTCHA_MODEL_PATH || path.resolve(__dirname, '../models/captcha_float32.tflite')

const WASM_RUNTIME = 'tflite_web_api_cc_simd'

const WIDTH = 120
const HEIGHT = 25
const NUM_CHARS = 5
// '_' is the padding class for captchas shorter than NUM_CHARS
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'
const NUM_CLASSES = CHARS.length

const vectorToArray = (vector) => {
  const items = []
  for (let i = 0; i < vector.size(); i++) items.push(vector.get(i))
  vector.delete()
  return items
}

const loadRunner = async () => {
  const wasmDir = path.join(
    path.dirname(require.resolve('@tensorflow/tfjs-tflite/package.json')),
    'wasm'
  )

  const createModule = require(path.join(wasmDir, `${WASM_RUNTIME}.js`))
  const [wasmBinary, modelBytes] = await Promise.all([
    fs.readFile(path.join(wasmDir, `${WASM_RUNTIME}.wasm`)),
    fs.readFile(MODEL_PATH)
  ])

  const wasm = await createModule({
    wasmBinary,
    // Silence TFLite's info logs ("Created TensorFlow Lite XNNPACK delegate")
    print: () => {},
    printErr: () => {}
  })

  // The model bytes must stay allocated for as long as the runner lives.
  const modelPtr = wasm._malloc(modelBytes.length)
  wasm.HEAPU8.set(modelBytes, modelPtr)

  const result = wasm.TFLiteWebModelRunner.CreateFromBufferAndOptions(
    modelPtr,
    modelBytes.length,
    { numThreads: 1, enableProfiling: false, maxProfilingBufferEntries: 1024 }
  )

  if (!result || !result.ok()) {
    throw new Error(`Failed to create TFLite runner: ${result?.errorMessage()}`)
  }

  return result.value()
}

// Cache the promise, not the runner, so logins arriving together share one
// load. A failed load is not cached, so the next call retries.
let runnerPromise = null

const getRunner = () => {
  if (!runnerPromise) {
    runnerPromise = loadRunner().catch((err) => {
      runnerPromise = null
      throw err
    })
  }

  return runnerPromise
}

// Float32Array of HEIGHT * WIDTH grayscale pixels scaled to 0..1. The model
// was trained on the top-left 120x25 crop of the captcha image.
const preprocess = async (imageBuffer) => {
  const { data, info } = await sharp(imageBuffer)
    .extract({ left: 0, top: 0, width: WIDTH, height: HEIGHT })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = new Float32Array(WIDTH * HEIGHT)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = data[i * info.channels] / 255
  }

  return pixels
}

// Fully synchronous, so concurrent logins cannot interleave inside it.
const infer = (runner, pixels) => {
  vectorToArray(runner.GetInputs())[0].data().set(pixels)

  if (!runner.Infer()) throw new Error('TFLite inference failed')

  // The output must be looked up after Infer(): TFLite only allocates it
  // then, so a reference taken earlier reads all zeros.
  return vectorToArray(runner.GetOutputs())[0].data()
}

const decode = (scores) => {
  let text = ''

  for (let charIdx = 0; charIdx < NUM_CHARS; charIdx++) {
    const offset = charIdx * NUM_CLASSES
    let best = 0

    for (let classIdx = 1; classIdx < NUM_CLASSES; classIdx++) {
      if (scores[offset + classIdx] > scores[offset + best]) best = classIdx
    }

    text += CHARS[best]
  }

  return text.replace(/_/g, '')
}

// Returns the captcha text for a PNG/JPEG image buffer. Throws on failure.
export const solveCaptchaImage = async (imageBuffer) => {
  const runner = await getRunner()
  const pixels = await preprocess(imageBuffer)
  return decode(infer(runner, pixels))
}

// Loads the model and pushes a blank image through the whole pipeline, so the
// first real captcha is as fast as later ones. Safe to call repeatedly — only
// the first call does any work.
let warmUpPromise = null

export const warmUpCaptchaSolver = () => {
  if (!warmUpPromise) {
    warmUpPromise = (async () => {
      const startedAt = performance.now()

      const blankImage = await sharp({
        create: { width: WIDTH, height: HEIGHT, channels: 3, background: 'white' }
      }).png().toBuffer()

      for (let i = 0; i < 3; i++) await solveCaptchaImage(blankImage)

      console.log(`[captcha] solver ready in ${(performance.now() - startedAt).toFixed(0)} ms`)
    })().catch((err) => {
      warmUpPromise = null
      throw err
    })
  }

  return warmUpPromise
}
