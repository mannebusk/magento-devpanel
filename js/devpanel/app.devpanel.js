webpackJsonp([2],{

/***/ 0:
/***/ function(module, exports, __webpack_require__) {

	module.exports = __webpack_require__(88);


/***/ },

/***/ 88:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	var _react = __webpack_require__(53);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(33);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	var _Panel = __webpack_require__(89);
	
	var _Panel2 = _interopRequireDefault(_Panel);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	document.addEventListener("DOMContentLoaded", function () {
	  _reactDom2.default.render(_react2.default.createElement(_Panel2.default, {
	    __source: {
	      fileName: '../../../../../src/js/app.js',
	      lineNumber: 11
	    }
	  }), document.querySelector("#dev-panel-root"));
	}); /**
	     * App enrty point
	     *
	     * @author Manne Busk <mannebusk@gmail.com>
	     */

/***/ },

/***/ 89:
/***/ function(module, exports, __webpack_require__) {

	'use strict';
	
	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	
	var _react = __webpack_require__(53);
	
	var _react2 = _interopRequireDefault(_react);
	
	var _reactDom = __webpack_require__(33);
	
	var _reactDom2 = _interopRequireDefault(_reactDom);
	
	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
	
	/**
	 * Panel js
	 *
	 * @author Manne Busk <mannebusk@gmail.com>
	 */
	
	var Panel = _react2.default.createClass({
	  displayName: 'Panel',
	
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
	          lineNumber: 80
	        }
	      },
	      _react2.default.createElement(
	        'h1',
	        {
	          __source: {
	            fileName: '../../../../../src/js/components/Panel.jsx',
	            lineNumber: 85
	          }
	        },
	        'Dev Panel'
	      ),
	      _react2.default.createElement('div', {
	        className: 'sneaker',
	        onClick: this.open,
	        __source: {
	          fileName: '../../../../../src/js/components/Panel.jsx',
	          lineNumber: 86
	        }
	      })
	    );
	  },
	
	  open: function open() {
	    this.setState({ open: true });
	  }
	});
	
	exports.default = Panel;

/***/ }

});
//# sourceMappingURL=app.devpanel.js.map