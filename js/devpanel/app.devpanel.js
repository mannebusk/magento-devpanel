webpackJsonp([1],{

/***/ 0:
/***/ function(module, exports, __webpack_require__) {

	module.exports = __webpack_require__(101);


/***/ },

/***/ 27:
/***/ function(module, exports) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.goToRoute = goToRoute;
	exports.openPanel = openPanel;
	exports.closePanel = closePanel;
	exports.showPanelSneakPeak = showPanelSneakPeak;
	exports.hidePanelSneakPeak = hidePanelSneakPeak;
	exports.openMenu = openMenu;
	exports.closeMenu = closeMenu;
	/**
	 * Application Actions
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	var routeConst = exports.routeConst = {
	  GOTO: "ROUTE_GOTO"
	};
	
	var panelConst = exports.panelConst = {
	  OPEN: "PANEL_OPEN",
	  CLOSE: "PANEL_CLOSE",
	  SHOW_SNEAKPEAK: "PANEL_SHOW_SNEAKPEAK",
	  HIDE_SNEAKPEAK: "PANEL_HIDE_SNEAKPEAK",
	  SHOW_MENU: "PANEL_MENU_SHOW",
	  HIDE_MENU: "PANEL_MENU_HIDE"
	};
	
	function goToRoute(route) {
	  return {
	    type: routeConst.GOTO,
	    route: route
	  };
	};
	
	function openPanel() {
	  return {
	    type: panelConst.OPEN,
	    open: true
	  };
	}
	
	function closePanel() {
	  return {
	    type: panelConst.CLOSE,
	    open: false
	  };
	}
	
	function showPanelSneakPeak() {
	  return {
	    type: panelConst.SHOW_SNEAKPEAK,
	    sneakPeak: true
	  };
	}
	
	function hidePanelSneakPeak() {
	  return {
	    type: panelConst.HIDE_SNEAKPEAK,
	    sneakPeak: false
	  };
	}
	
	function openMenu() {
	  return {
	    type: panelConst.SHOW_MENU,
	    showMenu: true
	  };
	}
	
	function closeMenu() {
	  return {
	    type: panelConst.HIDE_MENU,
	    showMenu: false
	  };
	}

/***/ },

/***/ 38:
/***/ function(module, exports, __webpack_require__) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(11);
	
	var _react2 = _interopRequireDefault(_react);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	exports.default = {
	  /**
	   * Get an icon and return it as an React component
	   *
	   * @param {String} name
	   *
	   * @return ReactElement
	   */
	  getIcon: function getIcon(svg) {
	
	    return _react2.default.createElement("span", {
	      className: "icon",
	      dangerouslySetInnerHTML: { __html: svg },
	      __source: {
	        fileName: "../../../../../src/js/mixins/IconMixin.jsx",
	        lineNumber: 18
	      }
	    });
	  }
	}; /**
	    * Icon Mixin
	    *
	    */

/***/ },

/***/ 101:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	var _react = __webpack_require__(11);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(20);
	
	var _reactRedux = __webpack_require__(28);
	
	var _redux = __webpack_require__(58);
	
	var _reducers = __webpack_require__(106);
	
	var _reducers2 = _interopRequireDefault(_reducers);
	
	var _Panel = __webpack_require__(103);
	
	var _Panel2 = _interopRequireDefault(_Panel);
	
	var _DevApp = __webpack_require__(102);
	
	var _DevApp2 = _interopRequireDefault(_DevApp);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	var store = undefined; /**
	                        * App enrty point
	                        *
	                        * @author Manne Busk <mannebusk@gmail.com>
	                        */
	
	var localState = localStorage.getItem('DevPanel');
	
	// Initialize store with state from local storage if exists
	if (localState) {
	  store = (0, _redux.createStore)(_reducers2.default, JSON.parse(localState));
	} else {
	  store = (0, _redux.createStore)(_reducers2.default);
	}
	
	// Save state to local storage when updated
	store.subscribe(function () {
	  localStorage.setItem("DevPanel", JSON.stringify(store.getState()));
	});
	
	// Render application when DOM is ready
	document.addEventListener("DOMContentLoaded", function () {
	  (0, _reactDom.render)(_react2.default.createElement(
	    _reactRedux.Provider,
	    { store: store, __source: {
	        fileName: '../../../../../src/js/app.js',
	        lineNumber: 32
	      }
	    },
	    _react2.default.createElement(
	      _Panel2.default,
	      {
	        __source: {
	          fileName: '../../../../../src/js/app.js',
	          lineNumber: 33
	        }
	      },
	      _react2.default.createElement(_DevApp2.default, {
	        __source: {
	          fileName: '../../../../../src/js/app.js',
	          lineNumber: 34
	        }
	      })
	    )
	  ), document.querySelector("#dev-panel-root"));
	});

/***/ },

/***/ 102:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; /**
	                                                                                                                                                                                                                                                                   * Dev Application Controller View
	                                                                                                                                                                                                                                                                   *
	                                                                                                                                                                                                                                                                   * @author Manne Busk <mannebusk@gmail.com>
	                                                                                                                                                                                                                                                                   */
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(11);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(20);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _IconMixin = __webpack_require__(38);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	var _reactRedux = __webpack_require__(28);
	
	var _Menu = __webpack_require__(105);
	
	var _Menu2 = _interopRequireDefault(_Menu);
	
	var _Router = __webpack_require__(104);
	
	var _Router2 = _interopRequireDefault(_Router);
	
	var _actions = __webpack_require__(27);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	var DevApp = _react2.default.createClass({
	  displayName: 'DevApp',
	
	  mixins: [_IconMixin2.default],
	
	  /**
	   * Toggle menu open
	   */
	  toggleMenu: function toggleMenu() {
	    if (this.props.panel.showMenu) {
	      this.props.dispatch((0, _actions.closeMenu)());
	    } else {
	      this.props.dispatch((0, _actions.openMenu)());
	    }
	  },
	
	  renderMenu: function renderMenu() {
	    if (!this.props.panel.showMenu) {
	      return "";
	    }
	
	    return _react2.default.createElement(_Menu2.default, { dispatch: this.props.dispatch, current: this.props.route, __source: {
	        fileName: '../../../../../src/js/components/DevApp.jsx',
	        lineNumber: 39
	      }
	    });
	  },
	
	  /**
	   * Render Component
	   *
	   * @return ReactElement
	   */
	  render: function render() {
	    return _react2.default.createElement(
	      'div',
	      {
	        __source: {
	          fileName: '../../../../../src/js/components/DevApp.jsx',
	          lineNumber: 50
	        }
	      },
	      _react2.default.createElement(
	        'div',
	        {
	          className: 'dp-header',
	          __source: {
	            fileName: '../../../../../src/js/components/DevApp.jsx',
	            lineNumber: 51
	          }
	        },
	        _react2.default.createElement(
	          'span',
	          { className: 'dp-app-title', __source: {
	              fileName: '../../../../../src/js/components/DevApp.jsx',
	              lineNumber: 54
	            }
	          },
	          _react2.default.createElement(
	            'span',
	            {
	              __source: {
	                fileName: '../../../../../src/js/components/DevApp.jsx',
	                lineNumber: 55
	              }
	            },
	            'DevPanel'
	          )
	        ),
	        _react2.default.createElement(
	          'button',
	          { className: 'dp-button', onClick: this.toggleMenu, __source: {
	              fileName: '../../../../../src/js/components/DevApp.jsx',
	              lineNumber: 57
	            }
	          },
	          this.getIcon(__webpack_require__(198))
	        )
	      ),
	      this.renderMenu(),
	      _react2.default.createElement(_Router2.default, _extends({}, this.props, {
	        __source: {
	          fileName: '../../../../../src/js/components/DevApp.jsx',
	          lineNumber: 62
	        }
	      }))
	    );
	  }
	});
	
	/**
	 * Select part of global state to be visible to component
	 *
	 * @param {Object} state
	 * @return {Object}
	 */
	function select(state) {
	  return state;
	}
	
	exports.default = (0, _reactRedux.connect)(select)(DevApp);

/***/ },

/***/ 103:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(11);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(20);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _reactRedux = __webpack_require__(28);
	
	var _IconMixin = __webpack_require__(38);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	var _actions = __webpack_require__(27);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	var Panel = _react2.default.createClass({
	  displayName: 'Panel',
	
	  /**
	   * Mixins
	   *
	   * @var {Array}
	   */
	  mixins: [_IconMixin2.default],
	
	  /**
	   * On component mount
	   */
	  componentDidMount: function componentDidMount() {
	    document.addEventListener('mousemove', this.toggleSneakPeak);
	    document.addEventListener('click', this.outsideClickHandler);
	  },
	
	  /**
	   * On component unmount
	   */
	  componentWillUnmount: function componentWillUnmount() {
	    document.removeEventListener(this.toggleSneakPeak);
	    document.removeEventListener(this.outsideClickHandler);
	  },
	
	  /**
	   * Handle mouse move event and toggle sneakPeak if near left edge of viewport
	   *
	   * @param MouseEvent e
	   */
	  toggleSneakPeak: function toggleSneakPeak(e) {
	    var padding = 50;
	    var el = this.refs.panel;
	
	    if (!this.props.sneakPeak && e.x <= padding) {
	      this.props.dispatch((0, _actions.showPanelSneakPeak)());
	    } else if (this.props.sneakPeak && e.x > padding) {
	      this.props.dispatch((0, _actions.hidePanelSneakPeak)());
	    }
	  },
	
	  /**
	   * Handle Clicks and close panel if click is outside
	   *
	   * @param MouseEvent e
	   */
	  outsideClickHandler: function outsideClickHandler(e) {
	    if (!this.props.open) {
	      return;
	    }
	
	    var clicked = e.target;
	    var panel = this.refs.panel;
	    var posNum = panel.compareDocumentPosition(clicked);
	
	    if (posNum <= 10 && posNum !== 0) {
	      e.preventDefault();
	      this.props.dispatch((0, _actions.closePanel)());
	    }
	  },
	
	  /**
	   * Render Component
	   *
	   * @return ReactElement
	   */
	  render: function render() {
	    var classNames = ["dev-panel"];
	
	    if (this.props.open) {
	      classNames.push('open');
	    } else if (this.props.sneakPeak) {
	      classNames.push('sneak-peak');
	    }
	
	    return _react2.default.createElement(
	      'div',
	      {
	        className: classNames.join(" "),
	        ref: 'panel',
	        id: 'dev-panel',
	        __source: {
	          fileName: '../../../../../src/js/components/Panel.jsx',
	          lineNumber: 93
	        }
	      },
	      _react2.default.createElement(
	        'div',
	        {
	          className: 'sneaker',
	          onClick: this.open,
	          __source: {
	            fileName: '../../../../../src/js/components/Panel.jsx',
	            lineNumber: 98
	          }
	        },
	        this.getIcon(__webpack_require__(194)),
	        _react2.default.createElement(
	          'h4',
	          { className: 'dp-text', __source: {
	              fileName: '../../../../../src/js/components/Panel.jsx',
	              lineNumber: 103
	            }
	          },
	          'dev'
	        )
	      ),
	      this.props.children
	    );
	  },
	
	  open: function open() {
	    this.props.dispatch((0, _actions.openPanel)());
	  }
	});
	
	/**
	 * Select part of global state to be visible to component
	 *
	 * @param {Object} state
	 * @return {Object}
	 */
	/**
	 * Panel js
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	function select(state) {
	  return state.panel;
	}
	
	exports.default = (0, _reactRedux.connect)(select)(Panel);

/***/ },

/***/ 104:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(11);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(20);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	/**
	 * Application router
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	exports.default = _react2.default.createClass({
	  displayName: 'Router',
	
	  /**
	   * Render Component for Route
	   *
	   * @return ReactElement
	   */
	  renderRoute: function renderRoute() {
	    switch (this.props.route) {
	      case "layout":
	        return _react2.default.createElement(
	          'h1',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/Router.jsx',
	              lineNumber: 20
	            }
	          },
	          'Layout debuger'
	        );
	        break;
	      case "accounts":
	        return _react2.default.createElement(
	          'h1',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/Router.jsx',
	              lineNumber: 25
	            }
	          },
	          'Accounts'
	        );
	        break;
	      case "cache":
	        return _react2.default.createElement(
	          'h1',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/Router.jsx',
	              lineNumber: 30
	            }
	          },
	          'Cache Management'
	        );
	        break;
	      case "configuration":
	        return _react2.default.createElement(
	          'h1',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/Router.jsx',
	              lineNumber: 35
	            }
	          },
	          'Comfiguration XML'
	        );
	        break;
	      default:
	        return "";
	        break;
	    }
	  },
	
	  /**
	   * Render Component
	   *
	   * @return ReactElement
	   */
	  render: function render() {
	    return _react2.default.createElement(
	      'div',
	      { className: 'dp-content', __source: {
	          fileName: '../../../../../src/js/components/Router.jsx',
	          lineNumber: 51
	        }
	      },
	      this.renderRoute()
	    );
	  }
	});

/***/ },

/***/ 105:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(11);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(20);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _IconMixin = __webpack_require__(38);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	var _actions = __webpack_require__(27);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	/**
	 * Menu
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	
	var Menu = _react2.default.createClass({
	  displayName: 'Menu',
	
	  mixins: [_IconMixin2.default],
	
	  /**
	   * Transition to a route on menu item click
	   *
	   * @param {String} route
	   */
	  goTo: function goTo(route) {
	    this.props.dispatch((0, _actions.goToRoute)(route));
	    this.props.dispatch((0, _actions.closeMenu)());
	  },
	
	  /**
	   * Render Component
	   *
	   * @return ReactElement
	   */
	  render: function render() {
	    return _react2.default.createElement(
	      'div',
	      { className: 'dp-menu', __source: {
	          fileName: '../../../../../src/js/components/layout/Menu.jsx',
	          lineNumber: 32
	        }
	      },
	      _react2.default.createElement(
	        'ul',
	        {
	          __source: {
	            fileName: '../../../../../src/js/components/layout/Menu.jsx',
	            lineNumber: 33
	          }
	        },
	        _react2.default.createElement(
	          'li',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/layout/Menu.jsx',
	              lineNumber: 34
	            }
	          },
	          _react2.default.createElement(
	            'a',
	            { href: '#', onClick: this.goTo.bind(this, 'layout'), __source: {
	                fileName: '../../../../../src/js/components/layout/Menu.jsx',
	                lineNumber: 35
	              }
	            },
	            this.getIcon(__webpack_require__(197)),
	            'Layout Debuger'
	          )
	        ),
	        _react2.default.createElement(
	          'li',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/layout/Menu.jsx',
	              lineNumber: 40
	            }
	          },
	          _react2.default.createElement(
	            'a',
	            { href: '#', onClick: this.goTo.bind(this, 'accounts'), __source: {
	                fileName: '../../../../../src/js/components/layout/Menu.jsx',
	                lineNumber: 41
	              }
	            },
	            this.getIcon(__webpack_require__(199)),
	            'Accounts'
	          )
	        ),
	        _react2.default.createElement(
	          'li',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/layout/Menu.jsx',
	              lineNumber: 46
	            }
	          },
	          _react2.default.createElement(
	            'a',
	            { href: '#', onClick: this.goTo.bind(this, 'cache'), __source: {
	                fileName: '../../../../../src/js/components/layout/Menu.jsx',
	                lineNumber: 47
	              }
	            },
	            this.getIcon(__webpack_require__(196)),
	            'Cache'
	          )
	        ),
	        _react2.default.createElement(
	          'li',
	          {
	            __source: {
	              fileName: '../../../../../src/js/components/layout/Menu.jsx',
	              lineNumber: 52
	            }
	          },
	          _react2.default.createElement(
	            'a',
	            { href: '#', onClick: this.goTo.bind(this, 'configuration'), __source: {
	                fileName: '../../../../../src/js/components/layout/Menu.jsx',
	                lineNumber: 53
	              }
	            },
	            this.getIcon(__webpack_require__(195)),
	            'Configuration XML'
	          )
	        )
	      )
	    );
	  }
	});
	
	exports.default = Menu;

/***/ },

/***/ 106:
/***/ function(module, exports, __webpack_require__) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.route = route;
	exports.panel = panel;
	
	var _actions = __webpack_require__(27);
	
	var _redux = __webpack_require__(58);
	
	/**
	 * Application Actions
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	function route() {
	  var state = arguments.length <= 0 || arguments[0] === undefined ? "" : arguments[0];
	  var action = arguments[1];
	
	  if (action.type == _actions.routeConst.GOTO) {
	    state = action.route;
	  }
	
	  return state;
	}
	
	function panel(state, action) {
	  if (!state) {
	    state = {
	      open: false,
	      loading: false,
	      sneakPeak: false,
	      showMenu: false
	    };
	  }
	
	  switch (action.type) {
	    case _actions.panelConst.OPEN:
	    case _actions.panelConst.CLOSE:
	      return Object.assign({}, state, {
	        open: action.open
	      });
	      break;
	
	    case _actions.panelConst.SHOW_SNEAKPEAK:
	    case _actions.panelConst.HIDE_SNEAKPEAK:
	      return Object.assign({}, state, {
	        sneakPeak: action.sneakPeak
	      });
	      break;
	
	    case _actions.panelConst.SHOW_MENU:
	    case _actions.panelConst.HIDE_MENU:
	      return Object.assign({}, state, {
	        showMenu: action.showMenu
	      });
	      break;
	
	    default:
	      break;
	  }
	
	  return state;
	}
	
	exports.default = (0, _redux.combineReducers)({
	  route: route,
	  panel: panel
	});

/***/ },

/***/ 194:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M.34 0a.5.5 0 0 0-.34.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.09 0 .5.5 0 0 0-.06 0zm1.16 1c.28 0 .5.22.5.5s-.22.5-.5.5-.5-.22-.5-.5.22-.5.5-.5zm2 0h3c.28 0 .5.22.5.5s-.22.5-.5.5h-3c-.28 0-.5-.22-.5-.5s.22-.5.5-.5zm-2.5 2h6v4h-6v-4z\"></path></svg>"

/***/ },

/***/ 195:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M5 0l-3 6h1l3-6h-1zm-4 1l-1 2 1 2h1l-1-2 1-2h-1zm5 0l1 2-1 2h1l1-2-1-2h-1z\" transform=\"translate(0 1)\"></path></svg>"

/***/ },

/***/ 196:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M1.5 0l-1.5 3h2l-.66 2h-1.34l1 3 3-3h-1.5l1.5-3h-2l1-2h-1.5z\" transform=\"translate(2)\"></path></svg>"

/***/ },

/***/ 197:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M0 0v4h4v-4h-4zm5 2v3h-3v1h4v-4h-1zm2 2v3h-3v1h4v-4h-1z\"></path></svg>"

/***/ },

/***/ 198:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M0 0v1h8v-1h-8zm0 2.97v1h8v-1h-8zm0 3v1h8v-1h-8z\" transform=\"translate(0 1)\"></path></svg>"

/***/ },

/***/ 199:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M4 0c-1.1 0-2 1.12-2 2.5s.9 2.5 2 2.5 2-1.12 2-2.5-.9-2.5-2-2.5zm-2.09 5c-1.06.05-1.91.92-1.91 2v1h8v-1c0-1.08-.84-1.95-1.91-2-.54.61-1.28 1-2.09 1-.81 0-1.55-.39-2.09-1z\"></path></svg>"

/***/ }

});
//# sourceMappingURL=app.devpanel.js.map