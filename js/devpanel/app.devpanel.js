webpackJsonp([1],{

/***/ 0:
/***/ function(module, exports, __webpack_require__) {

	module.exports = __webpack_require__(93);


/***/ },

/***/ 56:
/***/ function(module, exports, __webpack_require__) {

	"use strict";
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(25);
	
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

/***/ 93:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	var _react = __webpack_require__(25);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(26);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _Panel = __webpack_require__(95);
	
	var _Panel2 = _interopRequireDefault(_Panel);
	
	var _DevApp = __webpack_require__(94);
	
	var _DevApp2 = _interopRequireDefault(_DevApp);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	/**
	 * App enrty point
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	
	document.addEventListener("DOMContentLoaded", function () {
	  _reactDom2.default.render(_react2.default.createElement(
	    _Panel2.default,
	    {
	      __source: {
	        fileName: '../../../../../src/js/app.js',
	        lineNumber: 13
	      }
	    },
	    _react2.default.createElement(_DevApp2.default, {
	      __source: {
	        fileName: '../../../../../src/js/app.js',
	        lineNumber: 14
	      }
	    })
	  ), document.querySelector("#dev-panel-root"));
	});

/***/ },

/***/ 94:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(25);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(26);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _IconMixin = __webpack_require__(56);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
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
	          lineNumber: 21
	        }
	      },
	      _react2.default.createElement(
	        'div',
	        {
	          className: 'dp-header',
	          __source: {
	            fileName: '../../../../../src/js/components/DevApp.jsx',
	            lineNumber: 22
	          }
	        },
	        _react2.default.createElement(
	          'span',
	          { className: 'dp-app-title', __source: {
	              fileName: '../../../../../src/js/components/DevApp.jsx',
	              lineNumber: 25
	            }
	          },
	          _react2.default.createElement(
	            'span',
	            {
	              __source: {
	                fileName: '../../../../../src/js/components/DevApp.jsx',
	                lineNumber: 26
	              }
	            },
	            'DevPanel'
	          )
	        ),
	        _react2.default.createElement(
	          'button',
	          { className: 'dp-button', __source: {
	              fileName: '../../../../../src/js/components/DevApp.jsx',
	              lineNumber: 28
	            }
	          },
	          this.getIcon(__webpack_require__(173))
	        )
	      ),
	      _react2.default.createElement('div', {
	        className: 'dp-content',
	        __source: {
	          fileName: '../../../../../src/js/components/DevApp.jsx',
	          lineNumber: 32
	        }
	      })
	    );
	  }
	}); /**
	     * Dev Application Controller View
	     *
	     * @author Manne Busk <mannebusk@gmail.com>
	     */
	
	exports.default = DevApp;

/***/ },

/***/ 95:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(25);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(26);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _IconMixin = __webpack_require__(56);
	
	var _IconMixin2 = _interopRequireDefault(_IconMixin);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	var Panel = _react2.default.createClass({
	  displayName: 'Panel',
	
	  mixins: [_IconMixin2.default],
	
	  componentDidMount: function componentDidMount() {
	    document.addEventListener('mousemove', this.toggleSneakPeak);
	    document.addEventListener('click', this.outsideClickHandler);
	  },
	
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
	
	    if (!this.state.sneakPeak && e.x <= padding) {
	      this.setState({ sneakPeak: true });
	    } else if (this.state.sneakPeak && e.x > padding) {
	      this.setState({ sneakPeak: false });
	    }
	  },
	
	  /**
	   * Handle Clicks and close panel if click is outside
	   *
	   * @param MouseEvent e
	   */
	  outsideClickHandler: function outsideClickHandler(e) {
	    if (!this.state.open) {
	      return;
	    }
	
	    var clicked = e.target;
	    var panel = this.refs.panel;
	    var posNum = panel.compareDocumentPosition(clicked);
	
	    if (posNum <= 10 && posNum !== 0) {
	      e.preventDefault();
	      this.setState({ open: false });
	    }
	  },
	
	  /**
	   * Get the initial state
	   *
	   * @return {Object}
	   */
	  getInitialState: function getInitialState() {
	    return {
	      sneakPeak: false,
	      open: false
	    };
	  },
	
	  /**
	   * Render Component
	   *
	   * @return ReactElement
	   */
	  render: function render() {
	    var classNames = ["dev-panel"];
	
	    if (this.state.open) {
	      classNames.push('open');
	    } else if (this.state.sneakPeak) {
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
	          lineNumber: 88
	        }
	      },
	      _react2.default.createElement(
	        'div',
	        {
	          className: 'sneaker',
	          onClick: this.open,
	          __source: {
	            fileName: '../../../../../src/js/components/Panel.jsx',
	            lineNumber: 93
	          }
	        },
	        this.getIcon(__webpack_require__(172)),
	        _react2.default.createElement(
	          'h4',
	          { className: 'dp-text', __source: {
	              fileName: '../../../../../src/js/components/Panel.jsx',
	              lineNumber: 98
	            }
	          },
	          'dev'
	        )
	      ),
	      this.props.children
	    );
	  },
	
	  open: function open() {
	    this.setState({ open: true });
	  }
	}); /**
	     * Panel js
	     *
	     * @author Manne Busk <mannebusk@gmail.com>
	     */
	
	exports.default = Panel;

/***/ },

/***/ 172:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M.34 0a.5.5 0 0 0-.34.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.09 0 .5.5 0 0 0-.06 0zm1.16 1c.28 0 .5.22.5.5s-.22.5-.5.5-.5-.22-.5-.5.22-.5.5-.5zm2 0h3c.28 0 .5.22.5.5s-.22.5-.5.5h-3c-.28 0-.5-.22-.5-.5s.22-.5.5-.5zm-2.5 2h6v4h-6v-4z\"></path></svg>"

/***/ },

/***/ 173:
/***/ function(module, exports) {

	module.exports = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><path d=\"M0 0v1h8v-1h-8zm0 2.97v1h8v-1h-8zm0 3v1h8v-1h-8z\" transform=\"translate(0 1)\"></path></svg>"

/***/ }

});
//# sourceMappingURL=app.devpanel.js.map