'use strict';

module.exports = function(grunt) {

  require('time-grunt')(grunt);
  require('load-grunt-tasks')(grunt);

  // Project configuration.
  grunt.initConfig({

    /**
     * Configuration
     *
     * General configuration for grunt
     */
    config: {
      src: 'src',
      skin: 'skin/frontend/base/default/devpanel',
      js: 'js/devpanel',
      tmp: '.tmp'
    },

    /**
     * Watch
     *
     * Watch files for changes and run grunt tasks when changed
     */
    watch: {
      sass: {
        files: [
          '<%= config.src %>/sass/**/*.sass',
          '<%= config.src %>/sass/**/*.scss'
        ],
        tasks: ['sass:dist', 'autoprefixer:dist']
      },
      coffee: {
        files: [
          '<%= config.src %>/coffee/**/*.coffee',
          '<%= config.src %>/coffee/**/*.coffee'
        ],
        tasks: ['coffee:dist', 'concat:dist']
      },
      livereload: {
        options: {
          livereload: '<%= connect.options.livereload %>'
        },
        files: [
        ]
      }
    },

    /**
     * Connect
     *
     * Start server for livereload
     */
    connect: {
      options: {
        port: 9000,
        livereload: 35729,
        // change this to '0.0.0.0' to access the server from outside
        hostname: '0.0.0.0'
      },
      livereload: {
        options: {
          open: true
        }
      }
    },

    /**
     * Wiredep
     *
     * Automatically inject bower dependencies to html/sass
     */
    wiredep: {
      html: {
        // Point to the files that should be updated when
        // you run `grunt wiredep`
        src: [
        ],
        options: {
            exclude: []
        }
      },
      sass: {
        // Point to the files that should be updated when
        // you run `grunt wiredep`
        src: [
          '<%= config.src %>/sass/style.sass'
        ],
        options: {
            exclude: []
        }
      }
    },

    /**
     * Sass
     *
     * Compile sass/scss to css files
     */
    sass: {
      options: {
        sourcemap: true,
        loadPath: 'bower_components'
      },
      dist: {
        files: [{
          expand: true,
          cwd: "<%= config.src %>/sass",
          src: ['*.{scss,sass}'],
          dest: "<%= config.tmp %>/css",
          ext: '.css'
        }]
      }
    },


    /**
     * Autoprefixer
     *
     * Add browser prefixes to css files automatically
     */
    autoprefixer: {
      options: {
        browsers: ["last 3 version", "ie 9", "Firefox ESR"]
      },
      dist: {
        src: "<%= config.tmp %>/css/style.css",
        dest: "<%= config.skin %>/css/devpanel.css"
      }
    },

    /**
     * Coffeescript
     *
     * Compile coffeescript to js files
     */
    coffee: {
      dist: {
        options: {
          bare: false,
          join: true
        },
        files: {
          '<%= config.tmp %>/js/main.js': '<%= config.src %>/coffee/**/*.coffee'
        }
      },
      dev: {
        options: {
          bare: false,
          join: true
        },
        files: {
          '<%= config.dev %>/assets/js/main.js': '<%= config.src %>/coffee/**/*.coffee'
        }
      }
    },

    /**
     * Bower Concat
     *
     * Merge all bower dependencies to one file for production usage.
     * Order is by bower dependencies.
     */
    bower_concat: {
      dist: {
        dest: '<%= config.tmp %>/js/bower-components.js',
        cssDest: '<%= config.skin %>/css/bower-components.css',
        exclude: [
            'susy',
            'normalize-scss'
        ],
        dependencies: {
        },
        bowerOptions: {
          relative: false
        },
        mainFiles: {
            'codemirror': [
              './lib/codemirror.js',
              './lib/codemirror.css',
              './addon/fold/foldgutter.css',
              './addon/fold/foldcode.js',
              './addon/fold/xml-fold.js',
              './mode/xml/xml.js',
              './mode/javascript/javascript.js',
              './theme/monokai.css',
            ]
        }
      },
      dev: {
        dest: '<%= config.dev %>/assets/js/bower-components.js',
        cssDest: '<%= config.dev %>/assets/css/bower-components.css',
        exclude: [
            'susy'
        ],
        dependencies: {
        },
        bowerOptions: {
          relative: false
        }
      }
    },

    /**
     * Concat
     *
     * Merge all js files to one production file
     */
    concat: {
      options: {
        separator: ';',
        // Strip all comments to prevent weird line breaking errors
        stripBanners: true
      },
      dist: {
        // Here goes all the files that should be merged to production file
        src: [
          '<%= config.src %>/js/font.js',
          '<%= config.tmp %>/js/bower-components.js',
          '<%= config.tmp %>/js/main.js'
        ],
        dest: '<%= config.js %>/devpanel.js'
      }
    },

    /**
     * Copy
     *
     * Copy files to dev and dist location
     */
    copy: {
    },

    /**
     * Clean
     *
     * Before generating any new files,
     * remove any previously-created files.
     */
    clean: [
      '<%= config.tmp %>/**/*'
    ]

  });

  // Server task with watch and livereload
  grunt.registerTask('server', [
    'dist',
    // 'connect:livereload',
    'watch'
  ]);

  // Build production files
  grunt.registerTask('dist', [
    'clean',
    'wiredep:sass',
    'sass:dist',
    'autoprefixer:dist',
    'coffee:dist',
    'bower_concat:dist',
    'concat:dist',
  ]);

  // Default task
  grunt.registerTask('default', [
    'server'
  ]);

};
