webpackJsonp([1],{

/***/ 0:
/***/ function(module, exports, __webpack_require__) {

	module.exports = __webpack_require__(100);


/***/ },

/***/ 57:
/***/ function(module, exports, __webpack_require__) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(16);
	
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

/***/ 100:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	var _react = __webpack_require__(16);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(26);
	
	var _reactRedux = __webpack_require__(27);
	
	var _redux = __webpack_require__(94);
	
	var _reducers = __webpack_require__(218);
	
	var _reducers2 = _interopRequireDefault(_reducers);
	
	var _Panel = __webpack_require__(102);
	
	var _Panel2 = _interopRequireDefault(_Panel);
	
	var _DevApp = __webpack_require__(101);
	
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
	
	document.addEventListener("DOMContentLoaded", function () {
	  (0, _reactDom.render)(_react2.default.createElement(
	    _reactRedux.Provider,
	    { store: store, __source: {
	        fileName: '../../../../../src/js/app.js',
	        lineNumber: 27
	      }
	    },
	    _react2.default.createElement(
	      _Panel2.default,
	      {
	        __source: {
	          fileName: '../../../../../src/js/app.js',
	          lineNumber: 28
	        }
	      },
	      _react2.default.createElement(_DevApp2.default, {
	        __source: {
	          fileName: '../../../../../src/js/app.js',
	          lineNumber: 29
	        }
	      })
	    )
	  ), document.querySelector("#dev-panel-root"));
	});
	
	// Save state to local storage when updated
	store.subscribe(function () {
	  localStorage.setItem("DevPanel", JSON.stringify(store.getState()));
	});

/***/ },

/***/ 101:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(16);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(26);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _IconMixin = __webpack_require__(57);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	var _reactRedux = __webpack_require__(27);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	/**
	 * Dev Application Controller View
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	
	var DevApp = _react2.default.createClass({
	  displayName: 'DevApp',
	
	  mixins: [_IconMixin2.default],
	
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
	          lineNumber: 22
	        }
	      },
	      _react2.default.createElement(
	        'div',
	        {
	          className: 'dp-header',
	          __source: {
	            fileName: '../../../../../src/js/components/DevApp.jsx',
	            lineNumber: 23
	          }
	        },
	        _react2.default.createElement(
	          'span',
	          { className: 'dp-app-title', __source: {
	              fileName: '../../../../../src/js/components/DevApp.jsx',
	              lineNumber: 26
	            }
	          },
	          _react2.default.createElement(
	            'span',
	            {
	              __source: {
	                fileName: '../../../../../src/js/components/DevApp.jsx',
	                lineNumber: 27
	              }
	            },
	            'DevPanel'
	          )
	        ),
	        _react2.default.createElement(
	          'button',
	          { className: 'dp-button', __source: {
	              fileName: '../../../../../src/js/components/DevApp.jsx',
	              lineNumber: 29
	            }
	          },
	          this.getIcon(__webpack_require__(191))
	        )
	      ),
	      _react2.default.createElement('div', {
	        className: 'dp-content',
	        __source: {
	          fileName: '../../../../../src/js/components/DevApp.jsx',
	          lineNumber: 33
	        }
	      })
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

/***/ 102:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(16);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(26);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _reactRedux = __webpack_require__(27);
	
	var _IconMixin = __webpack_require__(57);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	var _actions = __webpack_require__(219);
	
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
	        this.getIcon(__webpack_require__(190)),
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

/***/ 190:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M.34 0a.5.5 0 0 0-.34.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.09 0 .5.5 0 0 0-.06 0zm1.16 1c.28 0 .5.22.5.5s-.22.5-.5.5-.5-.22-.5-.5.22-.5.5-.5zm2 0h3c.28 0 .5.22.5.5s-.22.5-.5.5h-3c-.28 0-.5-.22-.5-.5s.22-.5.5-.5zm-2.5 2h6v4h-6v-4z\"></path></svg>"

/***/ },

/***/ 191:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M0 0v1h8v-1h-8zm0 2.97v1h8v-1h-8zm0 3v1h8v-1h-8z\" transform=\"translate(0 1)\"></path></svg>"

/***/ },

/***/ 218:
/***/ function(module, exports, __webpack_require__) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.route = route;
	exports.panel = panel;
	
	var _actions = __webpack_require__(219);
	
	var _redux = __webpack_require__(94);
	
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
	      sneakPeak: false
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

/***/ 219:
/***/ function(module, exports) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.goToRoue = goToRoue;
	exports.openPanel = openPanel;
	exports.closePanel = closePanel;
	exports.showPanelSneakPeak = showPanelSneakPeak;
	exports.hidePanelSneakPeak = hidePanelSneakPeak;
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
	  HIDE_SNEAKPEAK: "PANEL_HIDE_SNEAKPEAK"
	};
	
	function goToRoue(route) {
	  return {
	    type: GOTO_ROUTE,
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

/***/ }

});
//# sourceMappingURL=app.devpanel.js.map