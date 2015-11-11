/**
 * Webpack configuration
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
var webpack           = require('webpack');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var packageJSON       = require('./package.json');

// Fetch all app vendor dependencies from package.json
var dependencies      = Object.keys(packageJSON.dependencies);

var excludes = [
  'open-iconic'
];

// Filter out excludes form dependencies
dependencies = dependencies.filter(function(dep) {
  return (excludes.indexOf(dep) === -1)
});

// General configuration
var config = {

  /**
   * Root context
   */
  context: __dirname,

  /**
   * Bundle entry points
   */
  entry: {
    // Application entry point, with dev server path for livereload to work
    app: ["./src/js/app.js"],
    // Array of all external libs to be put into separate vendor output
    vendor: dependencies,
    // Style entry point
    sass: "./src/sass/panel.sass"
  },

  /**
   * Output file settings
   */
  output: {
    path: __dirname + "/js/devpanel/",
    filename: "[name].devpanel.js"
  },

  /**
   * Plugins to use
   */
  plugins: [
    // Remove vendor files from blundle and split in to different output file.
    new webpack.optimize.CommonsChunkPlugin("vendor", "[name].devpanel.js"),

    // Optimize occurence order
    new webpack.optimize.OccurenceOrderPlugin(),

    // ExtractTextPlugin('style.css'),
  ],

  /**
   * devTools
   */
  devtool: "source-map",

  /**
   * Module settings
   */
  module: {
    loaders: [
      {
        test: /(\.js|\.jsx)$/,
        exclude: /(node_modules|bower_components)/,
        loader: "babel-loader",
        query: {
          presets: ['es2015', 'react']
        }
      },
      {
        test: /(\.css\.scss|\.sass)$/,
        loader: "style!css!autoprefixer!sass?outputStyle=expanded&indentedSyntax"
      },
      {
        test: /\.svg$/,
        loader: 'svg-inline',
        query: ['removeSvgTagAttrs=false']
      }
    ],
  },

  /**
   * Resolve settings
   */
  resolve: {
    root: __dirname + "/src/js/",
    fallback: [
      __dirname + "/node_modules/"
    ],
    alias: {
      icon: "open-iconic/svg"
    }
  }
};

module.exports = config;
