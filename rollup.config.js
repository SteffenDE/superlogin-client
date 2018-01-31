// rollup.config.js
import nodeResolve from "rollup-plugin-node-resolve";
import babel from "rollup-plugin-babel";
import commonjs from "rollup-plugin-commonjs";

export default {
  input: "src/index.js",
  output: {
    file: "lib/index.js",
    format: "cjs",
    name: "superlogin",
  },
  plugins: [
    nodeResolve({
      preferBuiltins: true,
      jsnext: true,
      main: true,
      browser: true
    }),
    commonjs({
      include: 'node_modules/**'
    }),
    babel({
      exclude: "node_modules/**",
      presets: [
        ["env", {
          "modules": false,
          "shippedProposals": true,
          "targets": {
            "browsers": ["> 1%", "last 2 versions", "not ie <= 8"]
          }
        }]
      ],
      plugins: [
        ["transform-runtime", {
        "helpers": false,
        "polyfill": false,
        "regenerator": true,
        "moduleName": "babel-runtime"
      }]],
      runtimeHelpers: true
    })
  ]
};
