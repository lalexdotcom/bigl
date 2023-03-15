const { resolve } = require("path");
const NodePolyfill = require("@rspack/plugin-node-polyfill");

module.exports = {
  entry: "./src/index.ts",
  plugins: [new NodePolyfill()],
  output: {
    filename: "index.js",
    path: resolve(__dirname, "dist"),
  },
};
