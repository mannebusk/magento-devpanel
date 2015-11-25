webpackJsonp([2],{

/***/ 0:
/***/ function(module, exports, __webpack_require__) {

	// style-loader: Adds some css to the DOM by adding a <style> tag
	
	// load the styles
	var content = __webpack_require__(103);
	if(typeof content === 'string') content = [[module.id, content, '']];
	// add the styles to the DOM
	var update = __webpack_require__(187)(content, {});
	if(content.locals) module.exports = content.locals;
	// Hot Module Replacement
	if(false) {
		// When the styles change, update the <style> tags
		if(!content.locals) {
			module.hot.accept("!!./../../node_modules/css-loader/index.js!./../../node_modules/autoprefixer-loader/index.js!./../../node_modules/sass-loader/index.js?outputStyle=expanded&indentedSyntax!./panel.sass", function() {
				var newContent = require("!!./../../node_modules/css-loader/index.js!./../../node_modules/autoprefixer-loader/index.js!./../../node_modules/sass-loader/index.js?outputStyle=expanded&indentedSyntax!./panel.sass");
				if(typeof newContent === 'string') newContent = [[module.id, newContent, '']];
				update(newContent);
			});
		}
		// When the module is disposed, remove the <style> tags
		module.hot.dispose(function() { update(); });
	}

/***/ },

/***/ 103:
/***/ function(module, exports, __webpack_require__) {

	exports = module.exports = __webpack_require__(104)();
	// imports
	exports.push([module.id, "@import url(https://fonts.googleapis.com/css?family=Source+Code+Pro:400,700,500);", ""]);
	
	// module
	exports.push([module.id, "/**\n * Global Configurations\n *\n * @author Manne Busk <mannebusk@gmail.com>\n */\n#dev-panel-root #dev-panel {\n  font-family: \"Source Code Pro\", sans-serif;\n  font-weight: normal;\n  font-style: normal;\n  color: #a1a1a1;\n  font-size: 1rem;\n}\n\n#dev-panel-root #dev-panel h1, #dev-panel-root #dev-panel h2, #dev-panel-root #dev-panel h3, #dev-panel-root #dev-panel h4, #dev-panel-root #dev-panel h5 {\n  font-family: \"Source Code Pro\", sans-serif;\n  font-weight: 700;\n  font-style: normal;\n}\n\n#dev-panel-root #dev-panel a {\n  color: inherit;\n}\n\n.icon {\n  display: inline-block;\n  width: 1.5rem;\n  height: 1.5rem;\n}\n\n.icon svg {\n  width: 100%;\n  height: 100%;\n  fill: #6F909C;\n}\n\n.dp-button {\n  background: #535353;\n  border: none;\n  padding: .5rem;\n  color: #6F909C;\n}\n\n#dev-panel .dp-header {\n  border-bottom: 1px solid #5f5f5f;\n  display: -webkit-box;\n  display: -webkit-flex;\n  display: -ms-flexbox;\n  display: flex;\n  -webkit-box-orient: horizontal;\n  -webkit-box-direction: normal;\n  -webkit-flex-direction: row;\n      -ms-flex-direction: row;\n          flex-direction: row;\n}\n\n#dev-panel .dp-header .dp-app-title {\n  position: relative;\n  background: #535353;\n  padding: .5rem 1rem;\n  -webkit-box-flex: 1;\n  -webkit-flex-grow: 1;\n      -ms-flex-positive: 1;\n          flex-grow: 1;\n  font-weight: 700;\n}\n\n#dev-panel .dp-header .dp-app-title > * {\n  display: inline-block;\n  vertical-align: middle;\n}\n\n#dev-panel .dp-header .dp-button {\n  border-left: 1px solid #5f5f5f;\n}\n\n#dev-panel .dp-header .dp-button .icon svg {\n  fill: #6F909C;\n}\n\n#dev-panel .dp-menu {\n  background: #535353;\n  height: 100vh;\n  padding: 2rem 0;\n}\n\n#dev-panel .dp-menu li {\n  padding: .5rem 2rem;\n  vertical-align: middle;\n}\n\n#dev-panel .dp-menu li .icon {\n  margin-right: 1rem;\n  vertical-align: middle;\n  display: inline-block;\n}\n\n#dev-panel .dp-menu li + li {\n  border-top: 1px solid #5E6265;\n}\n\n#dev-panel {\n  position: fixed;\n  top: 0;\n  left: 0;\n  -webkit-transform: translateX(calc(-100% - 2rem));\n      -ms-transform: translateX(calc(-100% - 2rem));\n          transform: translateX(calc(-100% - 2rem));\n  z-index: 9999;\n  width: 25vw;\n  height: 100vh;\n  min-width: 25rem;\n  -webkit-transition: -webkit-transform .2s ease-out;\n  transition: -webkit-transform .2s ease-out;\n  transition: transform .2s ease-out;\n  transition: transform .2s ease-out, -webkit-transform .2s ease-out;\n  overflow: visible;\n  background: #696f75;\n}\n\n#dev-panel html, #dev-panel body, #dev-panel div, #dev-panel span, #dev-panel applet, #dev-panel object, #dev-panel iframe, #dev-panel h1, #dev-panel h2, #dev-panel h3, #dev-panel h4, #dev-panel h5, #dev-panel h6, #dev-panel p, #dev-panel blockquote, #dev-panel pre, #dev-panel a, #dev-panel abbr, #dev-panel acronym, #dev-panel address, #dev-panel big, #dev-panel cite, #dev-panel code, #dev-panel del, #dev-panel dfn, #dev-panel em, #dev-panel img, #dev-panel ins, #dev-panel kbd, #dev-panel q, #dev-panel s, #dev-panel samp, #dev-panel small, #dev-panel strike, #dev-panel strong, #dev-panel sub, #dev-panel sup, #dev-panel tt, #dev-panel var, #dev-panel b, #dev-panel u, #dev-panel i, #dev-panel center, #dev-panel dl, #dev-panel dt, #dev-panel dd, #dev-panel ol, #dev-panel ul, #dev-panel li, #dev-panel fieldset, #dev-panel form, #dev-panel label, #dev-panel legend, #dev-panel table, #dev-panel caption, #dev-panel tbody, #dev-panel tfoot, #dev-panel thead, #dev-panel tr, #dev-panel th, #dev-panel td, #dev-panel article, #dev-panel aside, #dev-panel canvas, #dev-panel details, #dev-panel embed, #dev-panel figure, #dev-panel figcaption, #dev-panel footer, #dev-panel header, #dev-panel hgroup, #dev-panel menu, #dev-panel nav, #dev-panel output, #dev-panel ruby, #dev-panel section, #dev-panel summary, #dev-panel time, #dev-panel mark, #dev-panel audio, #dev-panel video, #dev-panel html:after, #dev-panel html:before, #dev-panel body:after, #dev-panel body:before, #dev-panel div:after, #dev-panel div:before, #dev-panel span:after, #dev-panel span:before, #dev-panel applet:after, #dev-panel applet:before, #dev-panel object:after, #dev-panel object:before, #dev-panel iframe:after, #dev-panel iframe:before, #dev-panel h1:after, #dev-panel h1:before, #dev-panel h2:after, #dev-panel h2:before, #dev-panel h3:after, #dev-panel h3:before, #dev-panel h4:after, #dev-panel h4:before, #dev-panel h5:after, #dev-panel h5:before, #dev-panel h6:after, #dev-panel h6:before, #dev-panel p:after, #dev-panel p:before, #dev-panel blockquote:after, #dev-panel blockquote:before, #dev-panel pre:after, #dev-panel pre:before, #dev-panel a:after, #dev-panel a:before, #dev-panel abbr:after, #dev-panel abbr:before, #dev-panel acronym:after, #dev-panel acronym:before, #dev-panel address:after, #dev-panel address:before, #dev-panel big:after, #dev-panel big:before, #dev-panel cite:after, #dev-panel cite:before, #dev-panel code:after, #dev-panel code:before, #dev-panel del:after, #dev-panel del:before, #dev-panel dfn:after, #dev-panel dfn:before, #dev-panel em:after, #dev-panel em:before, #dev-panel img:after, #dev-panel img:before, #dev-panel ins:after, #dev-panel ins:before, #dev-panel kbd:after, #dev-panel kbd:before, #dev-panel q:after, #dev-panel q:before, #dev-panel s:after, #dev-panel s:before, #dev-panel samp:after, #dev-panel samp:before, #dev-panel small:after, #dev-panel small:before, #dev-panel strike:after, #dev-panel strike:before, #dev-panel strong:after, #dev-panel strong:before, #dev-panel sub:after, #dev-panel sub:before, #dev-panel sup:after, #dev-panel sup:before, #dev-panel tt:after, #dev-panel tt:before, #dev-panel var:after, #dev-panel var:before, #dev-panel b:after, #dev-panel b:before, #dev-panel u:after, #dev-panel u:before, #dev-panel i:after, #dev-panel i:before, #dev-panel center:after, #dev-panel center:before, #dev-panel dl:after, #dev-panel dl:before, #dev-panel dt:after, #dev-panel dt:before, #dev-panel dd:after, #dev-panel dd:before, #dev-panel ol:after, #dev-panel ol:before, #dev-panel ul:after, #dev-panel ul:before, #dev-panel li:after, #dev-panel li:before, #dev-panel fieldset:after, #dev-panel fieldset:before, #dev-panel form:after, #dev-panel form:before, #dev-panel label:after, #dev-panel label:before, #dev-panel legend:after, #dev-panel legend:before, #dev-panel table:after, #dev-panel table:before, #dev-panel caption:after, #dev-panel caption:before, #dev-panel tbody:after, #dev-panel tbody:before, #dev-panel tfoot:after, #dev-panel tfoot:before, #dev-panel thead:after, #dev-panel thead:before, #dev-panel tr:after, #dev-panel tr:before, #dev-panel th:after, #dev-panel th:before, #dev-panel td:after, #dev-panel td:before, #dev-panel article:after, #dev-panel article:before, #dev-panel aside:after, #dev-panel aside:before, #dev-panel canvas:after, #dev-panel canvas:before, #dev-panel details:after, #dev-panel details:before, #dev-panel embed:after, #dev-panel embed:before, #dev-panel figure:after, #dev-panel figure:before, #dev-panel figcaption:after, #dev-panel figcaption:before, #dev-panel footer:after, #dev-panel footer:before, #dev-panel header:after, #dev-panel header:before, #dev-panel hgroup:after, #dev-panel hgroup:before, #dev-panel menu:after, #dev-panel menu:before, #dev-panel nav:after, #dev-panel nav:before, #dev-panel output:after, #dev-panel output:before, #dev-panel ruby:after, #dev-panel ruby:before, #dev-panel section:after, #dev-panel section:before, #dev-panel summary:after, #dev-panel summary:before, #dev-panel time:after, #dev-panel time:before, #dev-panel mark:after, #dev-panel mark:before, #dev-panel audio:after, #dev-panel audio:before, #dev-panel video:after, #dev-panel video:before {\n  margin: 0;\n  padding: 0;\n  border: 0;\n  font-size: 100%;\n  font: inherit;\n  vertical-align: baseline;\n  box-sizing: border-box;\n  letter-spacing: initial;\n  text-transform: none;\n  border-radius: inherit;\n}\n\n#dev-panel html:after, #dev-panel html:before, #dev-panel body:after, #dev-panel body:before, #dev-panel div:after, #dev-panel div:before, #dev-panel span:after, #dev-panel span:before, #dev-panel applet:after, #dev-panel applet:before, #dev-panel object:after, #dev-panel object:before, #dev-panel iframe:after, #dev-panel iframe:before, #dev-panel h1:after, #dev-panel h1:before, #dev-panel h2:after, #dev-panel h2:before, #dev-panel h3:after, #dev-panel h3:before, #dev-panel h4:after, #dev-panel h4:before, #dev-panel h5:after, #dev-panel h5:before, #dev-panel h6:after, #dev-panel h6:before, #dev-panel p:after, #dev-panel p:before, #dev-panel blockquote:after, #dev-panel blockquote:before, #dev-panel pre:after, #dev-panel pre:before, #dev-panel a:after, #dev-panel a:before, #dev-panel abbr:after, #dev-panel abbr:before, #dev-panel acronym:after, #dev-panel acronym:before, #dev-panel address:after, #dev-panel address:before, #dev-panel big:after, #dev-panel big:before, #dev-panel cite:after, #dev-panel cite:before, #dev-panel code:after, #dev-panel code:before, #dev-panel del:after, #dev-panel del:before, #dev-panel dfn:after, #dev-panel dfn:before, #dev-panel em:after, #dev-panel em:before, #dev-panel img:after, #dev-panel img:before, #dev-panel ins:after, #dev-panel ins:before, #dev-panel kbd:after, #dev-panel kbd:before, #dev-panel q:after, #dev-panel q:before, #dev-panel s:after, #dev-panel s:before, #dev-panel samp:after, #dev-panel samp:before, #dev-panel small:after, #dev-panel small:before, #dev-panel strike:after, #dev-panel strike:before, #dev-panel strong:after, #dev-panel strong:before, #dev-panel sub:after, #dev-panel sub:before, #dev-panel sup:after, #dev-panel sup:before, #dev-panel tt:after, #dev-panel tt:before, #dev-panel var:after, #dev-panel var:before, #dev-panel b:after, #dev-panel b:before, #dev-panel u:after, #dev-panel u:before, #dev-panel i:after, #dev-panel i:before, #dev-panel center:after, #dev-panel center:before, #dev-panel dl:after, #dev-panel dl:before, #dev-panel dt:after, #dev-panel dt:before, #dev-panel dd:after, #dev-panel dd:before, #dev-panel ol:after, #dev-panel ol:before, #dev-panel ul:after, #dev-panel ul:before, #dev-panel li:after, #dev-panel li:before, #dev-panel fieldset:after, #dev-panel fieldset:before, #dev-panel form:after, #dev-panel form:before, #dev-panel label:after, #dev-panel label:before, #dev-panel legend:after, #dev-panel legend:before, #dev-panel table:after, #dev-panel table:before, #dev-panel caption:after, #dev-panel caption:before, #dev-panel tbody:after, #dev-panel tbody:before, #dev-panel tfoot:after, #dev-panel tfoot:before, #dev-panel thead:after, #dev-panel thead:before, #dev-panel tr:after, #dev-panel tr:before, #dev-panel th:after, #dev-panel th:before, #dev-panel td:after, #dev-panel td:before, #dev-panel article:after, #dev-panel article:before, #dev-panel aside:after, #dev-panel aside:before, #dev-panel canvas:after, #dev-panel canvas:before, #dev-panel details:after, #dev-panel details:before, #dev-panel embed:after, #dev-panel embed:before, #dev-panel figure:after, #dev-panel figure:before, #dev-panel figcaption:after, #dev-panel figcaption:before, #dev-panel footer:after, #dev-panel footer:before, #dev-panel header:after, #dev-panel header:before, #dev-panel hgroup:after, #dev-panel hgroup:before, #dev-panel menu:after, #dev-panel menu:before, #dev-panel nav:after, #dev-panel nav:before, #dev-panel output:after, #dev-panel output:before, #dev-panel ruby:after, #dev-panel ruby:before, #dev-panel section:after, #dev-panel section:before, #dev-panel summary:after, #dev-panel summary:before, #dev-panel time:after, #dev-panel time:before, #dev-panel mark:after, #dev-panel mark:before, #dev-panel audio:after, #dev-panel audio:before, #dev-panel video:after, #dev-panel video:before {\n  content: none;\n}\n\n#dev-panel article, #dev-panel aside, #dev-panel details, #dev-panel figcaption, #dev-panel figure, #dev-panel footer, #dev-panel header, #dev-panel hgroup, #dev-panel menu, #dev-panel nav, #dev-panel section {\n  display: block;\n}\n\n#dev-panel body {\n  line-height: 1;\n}\n\n#dev-panel ol, #dev-panel ul {\n  list-style: none;\n}\n\n#dev-panel blockquote, #dev-panel q {\n  quotes: none;\n}\n\n#dev-panel blockquote:before, #dev-panel blockquote:after {\n  content: \"\";\n  content: none;\n}\n\n#dev-panel q:before, #dev-panel q:after {\n  content: \"\";\n  content: none;\n}\n\n#dev-panel table {\n  border-collapse: collapse;\n  border-spacing: 0;\n}\n\n#dev-panel .dp-content {\n  padding: 1rem;\n}\n\n#dev-panel.open {\n  -webkit-transform: translateX(0);\n      -ms-transform: translateX(0);\n          transform: translateX(0);\n  box-shadow: 2px 0 0.5rem rgba(0, 0, 0, 0.3);\n}\n\n#dev-panel.open .sneaker {\n  -webkit-transform: translateX(-100%) scale(0);\n      -ms-transform: translateX(-100%) scale(0);\n          transform: translateX(-100%) scale(0);\n}\n\n#dev-panel.sneak-peak {\n  -webkit-transform: translateX(-100%);\n      -ms-transform: translateX(-100%);\n          transform: translateX(-100%);\n}\n\n#dev-panel .sneaker {\n  width: 2rem;\n  height: 10rem;\n  position: absolute;\n  left: 100%;\n  top: 50%;\n  -webkit-transform: translateY(-50%);\n      -ms-transform: translateY(-50%);\n          transform: translateY(-50%);\n  background: #696f75;\n  -webkit-transition: all .2s ease-out;\n  transition: all .2s ease-out;\n  padding: .25rem;\n  cursor: pointer;\n}\n\n#dev-panel .sneaker h4.dp-text {\n  margin: 0 auto;\n  width: 1em;\n  word-wrap: break-word;\n  padding-left: 10%;\n  line-height: 1;\n  color: #6F909C;\n  position: absolute;\n  top: calc(50% + .5rem);\n  left: 50%;\n  -webkit-transform: translate(-50%, -50%);\n      -ms-transform: translate(-50%, -50%);\n          transform: translate(-50%, -50%);\n}\n", ""]);
	
	// exports


/***/ },

/***/ 104:
/***/ function(module, exports) {

	/*
		MIT License http://www.opensource.org/licenses/mit-license.php
		Author Tobias Koppers @sokra
	*/
	// css base code, injected by the css-loader
	module.exports = function() {
		var list = [];
	
		// return the list of modules as css string
		list.toString = function toString() {
			var result = [];
			for(var i = 0; i < this.length; i++) {
				var item = this[i];
				if(item[2]) {
					result.push("@media " + item[2] + "{" + item[1] + "}");
				} else {
					result.push(item[1]);
				}
			}
			return result.join("");
		};
	
		// import a list of modules into the list
		list.i = function(modules, mediaQuery) {
			if(typeof modules === "string")
				modules = [[null, modules, ""]];
			var alreadyImportedModules = {};
			for(var i = 0; i < this.length; i++) {
				var id = this[i][0];
				if(typeof id === "number")
					alreadyImportedModules[id] = true;
			}
			for(i = 0; i < modules.length; i++) {
				var item = modules[i];
				// skip already imported module
				// this implementation is not 100% perfect for weird media query combinations
				//  when a module is imported multiple times with different media queries.
				//  I hope this will never occur (Hey this way we have smaller bundles)
				if(typeof item[0] !== "number" || !alreadyImportedModules[item[0]]) {
					if(mediaQuery && !item[2]) {
						item[2] = mediaQuery;
					} else if(mediaQuery) {
						item[2] = "(" + item[2] + ") and (" + mediaQuery + ")";
					}
					list.push(item);
				}
			}
		};
		return list;
	};


/***/ },

/***/ 187:
/***/ function(module, exports, __webpack_require__) {

	/*
		MIT License http://www.opensource.org/licenses/mit-license.php
		Author Tobias Koppers @sokra
	*/
	var stylesInDom = {},
		memoize = function(fn) {
			var memo;
			return function () {
				if (typeof memo === "undefined") memo = fn.apply(this, arguments);
				return memo;
			};
		},
		isOldIE = memoize(function() {
			return /msie [6-9]\b/.test(window.navigator.userAgent.toLowerCase());
		}),
		getHeadElement = memoize(function () {
			return document.head || document.getElementsByTagName("head")[0];
		}),
		singletonElement = null,
		singletonCounter = 0;
	
	module.exports = function(list, options) {
		if(false) {
			if(typeof document !== "object") throw new Error("The style-loader cannot be used in a non-browser environment");
		}
	
		options = options || {};
		// Force single-tag solution on IE6-9, which has a hard limit on the # of <style>
		// tags it will allow on a page
		if (typeof options.singleton === "undefined") options.singleton = isOldIE();
	
		var styles = listToStyles(list);
		addStylesToDom(styles, options);
	
		return function update(newList) {
			var mayRemove = [];
			for(var i = 0; i < styles.length; i++) {
				var item = styles[i];
				var domStyle = stylesInDom[item.id];
				domStyle.refs--;
				mayRemove.push(domStyle);
			}
			if(newList) {
				var newStyles = listToStyles(newList);
				addStylesToDom(newStyles, options);
			}
			for(var i = 0; i < mayRemove.length; i++) {
				var domStyle = mayRemove[i];
				if(domStyle.refs === 0) {
					for(var j = 0; j < domStyle.parts.length; j++)
						domStyle.parts[j]();
					delete stylesInDom[domStyle.id];
				}
			}
		};
	}
	
	function addStylesToDom(styles, options) {
		for(var i = 0; i < styles.length; i++) {
			var item = styles[i];
			var domStyle = stylesInDom[item.id];
			if(domStyle) {
				domStyle.refs++;
				for(var j = 0; j < domStyle.parts.length; j++) {
					domStyle.parts[j](item.parts[j]);
				}
				for(; j < item.parts.length; j++) {
					domStyle.parts.push(addStyle(item.parts[j], options));
				}
			} else {
				var parts = [];
				for(var j = 0; j < item.parts.length; j++) {
					parts.push(addStyle(item.parts[j], options));
				}
				stylesInDom[item.id] = {id: item.id, refs: 1, parts: parts};
			}
		}
	}
	
	function listToStyles(list) {
		var styles = [];
		var newStyles = {};
		for(var i = 0; i < list.length; i++) {
			var item = list[i];
			var id = item[0];
			var css = item[1];
			var media = item[2];
			var sourceMap = item[3];
			var part = {css: css, media: media, sourceMap: sourceMap};
			if(!newStyles[id])
				styles.push(newStyles[id] = {id: id, parts: [part]});
			else
				newStyles[id].parts.push(part);
		}
		return styles;
	}
	
	function createStyleElement() {
		var styleElement = document.createElement("style");
		var head = getHeadElement();
		styleElement.type = "text/css";
		head.appendChild(styleElement);
		return styleElement;
	}
	
	function createLinkElement() {
		var linkElement = document.createElement("link");
		var head = getHeadElement();
		linkElement.rel = "stylesheet";
		head.appendChild(linkElement);
		return linkElement;
	}
	
	function addStyle(obj, options) {
		var styleElement, update, remove;
	
		if (options.singleton) {
			var styleIndex = singletonCounter++;
			styleElement = singletonElement || (singletonElement = createStyleElement());
			update = applyToSingletonTag.bind(null, styleElement, styleIndex, false);
			remove = applyToSingletonTag.bind(null, styleElement, styleIndex, true);
		} else if(obj.sourceMap &&
			typeof URL === "function" &&
			typeof URL.createObjectURL === "function" &&
			typeof URL.revokeObjectURL === "function" &&
			typeof Blob === "function" &&
			typeof btoa === "function") {
			styleElement = createLinkElement();
			update = updateLink.bind(null, styleElement);
			remove = function() {
				styleElement.parentNode.removeChild(styleElement);
				if(styleElement.href)
					URL.revokeObjectURL(styleElement.href);
			};
		} else {
			styleElement = createStyleElement();
			update = applyToTag.bind(null, styleElement);
			remove = function() {
				styleElement.parentNode.removeChild(styleElement);
			};
		}
	
		update(obj);
	
		return function updateStyle(newObj) {
			if(newObj) {
				if(newObj.css === obj.css && newObj.media === obj.media && newObj.sourceMap === obj.sourceMap)
					return;
				update(obj = newObj);
			} else {
				remove();
			}
		};
	}
	
	var replaceText = (function () {
		var textStore = [];
	
		return function (index, replacement) {
			textStore[index] = replacement;
			return textStore.filter(Boolean).join('\n');
		};
	})();
	
	function applyToSingletonTag(styleElement, index, remove, obj) {
		var css = remove ? "" : obj.css;
	
		if (styleElement.styleSheet) {
			styleElement.styleSheet.cssText = replaceText(index, css);
		} else {
			var cssNode = document.createTextNode(css);
			var childNodes = styleElement.childNodes;
			if (childNodes[index]) styleElement.removeChild(childNodes[index]);
			if (childNodes.length) {
				styleElement.insertBefore(cssNode, childNodes[index]);
			} else {
				styleElement.appendChild(cssNode);
			}
		}
	}
	
	function applyToTag(styleElement, obj) {
		var css = obj.css;
		var media = obj.media;
		var sourceMap = obj.sourceMap;
	
		if(media) {
			styleElement.setAttribute("media", media)
		}
	
		if(styleElement.styleSheet) {
			styleElement.styleSheet.cssText = css;
		} else {
			while(styleElement.firstChild) {
				styleElement.removeChild(styleElement.firstChild);
			}
			styleElement.appendChild(document.createTextNode(css));
		}
	}
	
	function updateLink(linkElement, obj) {
		var css = obj.css;
		var media = obj.media;
		var sourceMap = obj.sourceMap;
	
		if(sourceMap) {
			// http://stackoverflow.com/a/26603875
			css += "\n/*# sourceMappingURL=data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))) + " */";
		}
	
		var blob = new Blob([css], { type: "text/css" });
	
		var oldSrc = linkElement.href;
	
		linkElement.href = URL.createObjectURL(blob);
	
		if(oldSrc)
			URL.revokeObjectURL(oldSrc);
	}


/***/ }

});
//# sourceMappingURL=sass.devpanel.js.map