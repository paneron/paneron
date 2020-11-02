const path = require('path');

module.exports = function (config) {
  config.externals = [ ...config.externals, 'react' ];
  config.resolve.modules = [path.resolve(__dirname, './src'), 'node_modules'];
  return config;
}
