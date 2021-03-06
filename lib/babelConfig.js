"use strict";

require('@babel/register')({
  ignore: [/(node_modules)/],
  presets: [['@babel/preset-env', {
    targets: {
      node: 'current'
    }
  }], '@babel/preset-react'],
  plugins: ["syntax-dynamic-import"]
});