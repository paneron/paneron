const path = require('path');
const ThreadsPlugin = require('threads-plugin');

module.exports = function (config) {
  config.optimization.minimizer = [];

  config.resolve.modules = [path.resolve(__dirname, './src'), 'node_modules'];

  config.module.rules = config.module.rules.filter(r => {
    return (r.use !== 'node-loader');
  });

  config.module.rules.unshift({
    test: /\.node$/,
    use: {
      loader: 'native-ext-loader',
      options: {
        rewritePath: undefined,
        name: '[path][name].[ext]',
      },
    },
  });

  config.plugins.unshift(
    new ThreadsPlugin({ target: 'electron-node-worker' })
  );

  return config;
}
