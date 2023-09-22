import { resolve } from 'path'
import { defineConfig } from 'vite'
import JSZip from 'jszip'
import fs from 'fs'
import path from 'path'

const awsSdkExternals = [
  '@aws-sdk/client-sns',
  '@aws-sdk/lib-dynamodb',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/types',
]

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'WaterLevelLambdaApi',
      fileName: 'water-level-lambda-api',
    },
    rollupOptions: {
      external: awsSdkExternals,
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          ...Object.fromEntries(awsSdkExternals.map((x) => [x, x])),
        },
      },
    },
  },
  plugins: [
    {
      name: "vite-plugin-zip-pack",
      apply: "build",
      closeBundle() {
        console.log("\x1b[36m%s\x1b[0m", `Creating lambda zip file...`);
        const dir = resolve(__dirname + "/dist");
        const zip = new JSZip();
        zip.file("lambda.mjs", fs.readFileSync(dir + "/water-level-lambda-api.mjs"));
        zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
          compressionOptions: {
            level: 9,
          },
        }).then((file) => {
          const zipFilePath = path.join(dir, "lambda.zip");
          if (fs.existsSync(zipFilePath)) {
            fs.unlinkSync(zipFilePath);
          }
          fs.writeFileSync(zipFilePath, file);
        });
      },
    },
  ]
})
