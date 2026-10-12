// Builds the playable demo (src/demo/main.ts + demo/index.html) into dist-demo/.
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (_env, argv) => ({
  entry: './src/demo/main.ts',
  devtool: argv.mode === 'production' ? false : 'eval-source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: { loader: 'ts-loader', options: { transpileOnly: true } },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: { extensions: ['.ts', '.js'] },
  output: {
    filename: 'bundle.[contenthash:8].js',
    path: path.resolve(__dirname, 'dist-demo'),
    clean: true,
  },
  plugins: [new HtmlWebpackPlugin({ template: './demo/index.html' })],
  performance: { hints: false },
  devServer: { static: './dist-demo', port: 8080, open: false },
});
