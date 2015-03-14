WebFontConfig = {
  google: { families: [ 'Source+Code+Pro:400,600,700:latin' ] }
};
(function() {
  var wf = document.createElement('script');
  wf.src = ('https:' == document.location.protocol ? 'https' : 'http') +
    '://ajax.googleapis.com/ajax/libs/webfont/1/webfont.js';
  wf.type = 'text/javascript';
  wf.async = 'true';
  var s = document.getElementsByTagName('script')[0];
  s.parentNode.insertBefore(wf, s);
})();
;// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    module.exports = mod();
  else if (typeof define == "function" && define.amd) // AMD
    return define([], mod);
  else // Plain browser env
    this.CodeMirror = mod();
})(function() {
  "use strict";

  // BROWSER SNIFFING

  // Kludges for bugs and behavior differences that can't be feature
  // detected are enabled based on userAgent etc sniffing.

  var gecko = /gecko\/\d/i.test(navigator.userAgent);
  // ie_uptoN means Internet Explorer version N or lower
  var ie_upto10 = /MSIE \d/.test(navigator.userAgent);
  var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent);
  var ie = ie_upto10 || ie_11up;
  var ie_version = ie && (ie_upto10 ? document.documentMode || 6 : ie_11up[1]);
  var webkit = /WebKit\//.test(navigator.userAgent);
  var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
  var chrome = /Chrome\//.test(navigator.userAgent);
  var presto = /Opera\//.test(navigator.userAgent);
  var safari = /Apple Computer/.test(navigator.vendor);
  var khtml = /KHTML\//.test(navigator.userAgent);
  var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
  var phantom = /PhantomJS/.test(navigator.userAgent);

  var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
  // This is woefully incomplete. Suggestions for alternative methods welcome.
  var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
  var mac = ios || /Mac/.test(navigator.platform);
  var windows = /win/i.test(navigator.platform);

  var presto_version = presto && navigator.userAgent.match(/Version\/(\d*\.\d*)/);
  if (presto_version) presto_version = Number(presto_version[1]);
  if (presto_version && presto_version >= 15) { presto = false; webkit = true; }
  // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
  var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
  var captureRightClick = gecko || (ie && ie_version >= 9);

  // Optimize some code when these features are not used.
  var sawReadOnlySpans = false, sawCollapsedSpans = false;

  // EDITOR CONSTRUCTOR

  // A CodeMirror instance represents an editor. This is the object
  // that user code is usually dealing with.

  function CodeMirror(place, options) {
    if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

    this.options = options = options ? copyObj(options) : {};
    // Determine effective options based on given values and defaults.
    copyObj(defaults, options, false);
    setGuttersForLineNumbers(options);

    var doc = options.value;
    if (typeof doc == "string") doc = new Doc(doc, options.mode);
    this.doc = doc;

    var display = this.display = new Display(place, doc);
    display.wrapper.CodeMirror = this;
    updateGutters(this);
    themeChanged(this);
    if (options.lineWrapping)
      this.display.wrapper.className += " CodeMirror-wrap";
    if (options.autofocus && !mobile) focusInput(this);
    initScrollbars(this);

    this.state = {
      keyMaps: [],  // stores maps added by addKeyMap
      overlays: [], // highlighting overlays, as added by addOverlay
      modeGen: 0,   // bumped when mode/overlay changes, used to invalidate highlighting info
      overwrite: false, focused: false,
      suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
      pasteIncoming: false, cutIncoming: false, // help recognize paste/cut edits in readInput
      draggingText: false,
      highlight: new Delayed(), // stores highlight worker timeout
      keySeq: null  // Unfinished key sequence
    };

    // Override magic textarea content restore that IE sometimes does
    // on our hidden textarea on reload
    if (ie && ie_version < 11) setTimeout(bind(resetInput, this, true), 20);

    registerEventHandlers(this);
    ensureGlobalHandlers();

    startOperation(this);
    this.curOp.forceUpdate = true;
    attachDoc(this, doc);

    if ((options.autofocus && !mobile) || activeElt() == display.input)
      setTimeout(bind(onFocus, this), 20);
    else
      onBlur(this);

    for (var opt in optionHandlers) if (optionHandlers.hasOwnProperty(opt))
      optionHandlers[opt](this, options[opt], Init);
    maybeUpdateLineNumberWidth(this);
    for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
    endOperation(this);
    // Suppress optimizelegibility in Webkit, since it breaks text
    // measuring on line wrapping boundaries.
    if (webkit && options.lineWrapping &&
        getComputedStyle(display.lineDiv).textRendering == "optimizelegibility")
      display.lineDiv.style.textRendering = "auto";
  }

  // DISPLAY CONSTRUCTOR

  // The display handles the DOM integration, both for input reading
  // and content drawing. It holds references to DOM nodes and
  // display-related state.

  function Display(place, doc) {
    var d = this;

    // The semihidden textarea that is focused when the editor is
    // focused, and receives input.
    var input = d.input = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
    // The textarea is kept positioned near the cursor to prevent the
    // fact that it'll be scrolled into view on input from scrolling
    // our fake cursor out of view. On webkit, when wrap=off, paste is
    // very slow. So make the area wide instead.
    if (webkit) input.style.width = "1000px";
    else input.setAttribute("wrap", "off");
    // If border: 0; -- iOS fails to open keyboard (issue #1287)
    if (ios) input.style.border = "1px solid black";
    input.setAttribute("autocorrect", "off"); input.setAttribute("autocapitalize", "off"); input.setAttribute("spellcheck", "false");

    // Wraps and hides input textarea
    d.inputDiv = elt("div", [input], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
    // Covers bottom-right square when both scrollbars are present.
    d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    d.scrollbarFiller.setAttribute("not-content", "true");
    // Covers bottom of gutter when coverGutterNextToScrollbar is on
    // and h scrollbar is present.
    d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
    d.gutterFiller.setAttribute("not-content", "true");
    // Will contain the actual code, positioned to cover the viewport.
    d.lineDiv = elt("div", null, "CodeMirror-code");
    // Elements are added to these to represent selection and cursors.
    d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    d.cursorDiv = elt("div", null, "CodeMirror-cursors");
    // A visibility: hidden element used to find the size of things.
    d.measure = elt("div", null, "CodeMirror-measure");
    // When lines outside of the viewport are measured, they are drawn in this.
    d.lineMeasure = elt("div", null, "CodeMirror-measure");
    // Wraps everything that needs to exist inside the vertically-padded coordinate system
    d.lineSpace = elt("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
                      null, "position: relative; outline: none");
    // Moved around its parent to cover visible view.
    d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
    // Set to the height of the document, allowing scrolling.
    d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
    d.sizerWidth = null;
    // Behavior of elts with overflow: auto and padding is
    // inconsistent across browsers. This is used to ensure the
    // scrollable area is big enough.
    d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerGap + "px; width: 1px;");
    // Will contain the gutters, if any.
    d.gutters = elt("div", null, "CodeMirror-gutters");
    d.lineGutter = null;
    // Actual scrollable element.
    d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
    d.scroller.setAttribute("tabIndex", "-1");
    // The element in which the editor lives.
    d.wrapper = elt("div", [d.inputDiv, d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

    // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
    if (ie && ie_version < 8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
    // Needed to hide big blue blinking cursor on Mobile Safari
    if (ios) input.style.width = "0px";
    if (!webkit) d.scroller.draggable = true;
    // Needed to handle Tab key in KHTML
    if (khtml) { d.inputDiv.style.height = "1px"; d.inputDiv.style.position = "absolute"; }

    if (place) {
      if (place.appendChild) place.appendChild(d.wrapper);
      else place(d.wrapper);
    }

    // Current rendered range (may be bigger than the view window).
    d.viewFrom = d.viewTo = doc.first;
    d.reportedViewFrom = d.reportedViewTo = doc.first;
    // Information about the rendered lines.
    d.view = [];
    d.renderedView = null;
    // Holds info about a single rendered line when it was rendered
    // for measurement, while not in view.
    d.externalMeasured = null;
    // Empty space (in pixels) above the view
    d.viewOffset = 0;
    d.lastWrapHeight = d.lastWrapWidth = 0;
    d.updateLineNumbers = null;

    d.nativeBarWidth = d.barHeight = d.barWidth = 0;
    d.scrollbarsClipped = false;

    // Used to only resize the line number gutter when necessary (when
    // the amount of lines crosses a boundary that makes its width change)
    d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
    // See readInput and resetInput
    d.prevInput = "";
    // Set to true when a non-horizontal-scrolling line widget is
    // added. As an optimization, line widget aligning is skipped when
    // this is false.
    d.alignWidgets = false;
    // Flag that indicates whether we expect input to appear real soon
    // now (after some event like 'keypress' or 'input') and are
    // polling intensively.
    d.pollingFast = false;
    // Self-resetting timeout for the poller
    d.poll = new Delayed();

    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

    // Tracks when resetInput has punted to just putting a short
    // string into the textarea instead of the full selection.
    d.inaccurateSelection = false;

    // Tracks the maximum line length so that the horizontal scrollbar
    // can be kept static when scrolling.
    d.maxLine = null;
    d.maxLineLength = 0;
    d.maxLineChanged = false;

    // Used for measuring wheel scrolling granularity
    d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

    // True when shift is held down.
    d.shift = false;

    // Used to track whether anything happened since the context menu
    // was opened.
    d.selForContextMenu = null;
  }

  // STATE UPDATES

  // Used to get the editor into a consistent state again when options change.

  function loadMode(cm) {
    cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
    resetModeState(cm);
  }

  function resetModeState(cm) {
    cm.doc.iter(function(line) {
      if (line.stateAfter) line.stateAfter = null;
      if (line.styles) line.styles = null;
    });
    cm.doc.frontier = cm.doc.first;
    startWorker(cm, 100);
    cm.state.modeGen++;
    if (cm.curOp) regChange(cm);
  }

  function wrappingChanged(cm) {
    if (cm.options.lineWrapping) {
      addClass(cm.display.wrapper, "CodeMirror-wrap");
      cm.display.sizer.style.minWidth = "";
      cm.display.sizerWidth = null;
    } else {
      rmClass(cm.display.wrapper, "CodeMirror-wrap");
      findMaxLine(cm);
    }
    estimateLineHeights(cm);
    regChange(cm);
    clearCaches(cm);
    setTimeout(function(){updateScrollbars(cm);}, 100);
  }

  // Returns a function that estimates the height of a line, to use as
  // first approximation until the line becomes visible (and is thus
  // properly measurable).
  function estimateHeight(cm) {
    var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
    var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
    return function(line) {
      if (lineIsHidden(cm.doc, line)) return 0;

      var widgetsHeight = 0;
      if (line.widgets) for (var i = 0; i < line.widgets.length; i++) {
        if (line.widgets[i].height) widgetsHeight += line.widgets[i].height;
      }

      if (wrapping)
        return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th;
      else
        return widgetsHeight + th;
    };
  }

  function estimateLineHeights(cm) {
    var doc = cm.doc, est = estimateHeight(cm);
    doc.iter(function(line) {
      var estHeight = est(line);
      if (estHeight != line.height) updateLineHeight(line, estHeight);
    });
  }

  function themeChanged(cm) {
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
      cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
    clearCaches(cm);
  }

  function guttersChanged(cm) {
    updateGutters(cm);
    regChange(cm);
    setTimeout(function(){alignHorizontally(cm);}, 20);
  }

  // Rebuild the gutter elements, ensure the margin to the left of the
  // code matches their width.
  function updateGutters(cm) {
    var gutters = cm.display.gutters, specs = cm.options.gutters;
    removeChildren(gutters);
    for (var i = 0; i < specs.length; ++i) {
      var gutterClass = specs[i];
      var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
      if (gutterClass == "CodeMirror-linenumbers") {
        cm.display.lineGutter = gElt;
        gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
      }
    }
    gutters.style.display = i ? "" : "none";
    updateGutterSpace(cm);
  }

  function updateGutterSpace(cm) {
    var width = cm.display.gutters.offsetWidth;
    cm.display.sizer.style.marginLeft = width + "px";
  }

  // Compute the character length of a line, taking into account
  // collapsed ranges (see markText) that might hide parts, and join
  // other lines onto it.
  function lineLength(line) {
    if (line.height == 0) return 0;
    var len = line.text.length, merged, cur = line;
    while (merged = collapsedSpanAtStart(cur)) {
      var found = merged.find(0, true);
      cur = found.from.line;
      len += found.from.ch - found.to.ch;
    }
    cur = line;
    while (merged = collapsedSpanAtEnd(cur)) {
      var found = merged.find(0, true);
      len -= cur.text.length - found.from.ch;
      cur = found.to.line;
      len += cur.text.length - found.to.ch;
    }
    return len;
  }

  // Find the longest line in the document.
  function findMaxLine(cm) {
    var d = cm.display, doc = cm.doc;
    d.maxLine = getLine(doc, doc.first);
    d.maxLineLength = lineLength(d.maxLine);
    d.maxLineChanged = true;
    doc.iter(function(line) {
      var len = lineLength(line);
      if (len > d.maxLineLength) {
        d.maxLineLength = len;
        d.maxLine = line;
      }
    });
  }

  // Make sure the gutters options contains the element
  // "CodeMirror-linenumbers" when the lineNumbers option is true.
  function setGuttersForLineNumbers(options) {
    var found = indexOf(options.gutters, "CodeMirror-linenumbers");
    if (found == -1 && options.lineNumbers) {
      options.gutters = options.gutters.concat(["CodeMirror-linenumbers"]);
    } else if (found > -1 && !options.lineNumbers) {
      options.gutters = options.gutters.slice(0);
      options.gutters.splice(found, 1);
    }
  }

  // SCROLLBARS

  // Prepare DOM reads needed to update the scrollbars. Done in one
  // shot to minimize update/measure roundtrips.
  function measureForScrollbars(cm) {
    var d = cm.display, gutterW = d.gutters.offsetWidth;
    var docH = Math.round(cm.doc.height + paddingVert(cm.display));
    return {
      clientHeight: d.scroller.clientHeight,
      viewHeight: d.wrapper.clientHeight,
      scrollWidth: d.scroller.scrollWidth, clientWidth: d.scroller.clientWidth,
      viewWidth: d.wrapper.clientWidth,
      barLeft: cm.options.fixedGutter ? gutterW : 0,
      docHeight: docH,
      scrollHeight: docH + scrollGap(cm) + d.barHeight,
      nativeBarWidth: d.nativeBarWidth,
      gutterWidth: gutterW
    };
  }

  function NativeScrollbars(place, scroll, cm) {
    this.cm = cm;
    var vert = this.vert = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
    var horiz = this.horiz = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
    place(vert); place(horiz);

    on(vert, "scroll", function() {
      if (vert.clientHeight) scroll(vert.scrollTop, "vertical");
    });
    on(horiz, "scroll", function() {
      if (horiz.clientWidth) scroll(horiz.scrollLeft, "horizontal");
    });

    this.checkedOverlay = false;
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    if (ie && ie_version < 8) this.horiz.style.minHeight = this.vert.style.minWidth = "18px";
  }

  NativeScrollbars.prototype = copyObj({
    update: function(measure) {
      var needsH = measure.scrollWidth > measure.clientWidth + 1;
      var needsV = measure.scrollHeight > measure.clientHeight + 1;
      var sWidth = measure.nativeBarWidth;

      if (needsV) {
        this.vert.style.display = "block";
        this.vert.style.bottom = needsH ? sWidth + "px" : "0";
        var totalHeight = measure.viewHeight - (needsH ? sWidth : 0);
        // A bug in IE8 can cause this value to be negative, so guard it.
        this.vert.firstChild.style.height =
          Math.max(0, measure.scrollHeight - measure.clientHeight + totalHeight) + "px";
      } else {
        this.vert.style.display = "";
        this.vert.firstChild.style.height = "0";
      }

      if (needsH) {
        this.horiz.style.display = "block";
        this.horiz.style.right = needsV ? sWidth + "px" : "0";
        this.horiz.style.left = measure.barLeft + "px";
        var totalWidth = measure.viewWidth - measure.barLeft - (needsV ? sWidth : 0);
        this.horiz.firstChild.style.width =
          (measure.scrollWidth - measure.clientWidth + totalWidth) + "px";
      } else {
        this.horiz.style.display = "";
        this.horiz.firstChild.style.width = "0";
      }

      if (!this.checkedOverlay && measure.clientHeight > 0) {
        if (sWidth == 0) this.overlayHack();
        this.checkedOverlay = true;
      }

      return {right: needsV ? sWidth : 0, bottom: needsH ? sWidth : 0};
    },
    setScrollLeft: function(pos) {
      if (this.horiz.scrollLeft != pos) this.horiz.scrollLeft = pos;
    },
    setScrollTop: function(pos) {
      if (this.vert.scrollTop != pos) this.vert.scrollTop = pos;
    },
    overlayHack: function() {
      var w = mac && !mac_geMountainLion ? "12px" : "18px";
      this.horiz.style.minHeight = this.vert.style.minWidth = w;
      var self = this;
      var barMouseDown = function(e) {
        if (e_target(e) != self.vert && e_target(e) != self.horiz)
          operation(self.cm, onMouseDown)(e);
      };
      on(this.vert, "mousedown", barMouseDown);
      on(this.horiz, "mousedown", barMouseDown);
    },
    clear: function() {
      var parent = this.horiz.parentNode;
      parent.removeChild(this.horiz);
      parent.removeChild(this.vert);
    }
  }, NativeScrollbars.prototype);

  function NullScrollbars() {}

  NullScrollbars.prototype = copyObj({
    update: function() { return {bottom: 0, right: 0}; },
    setScrollLeft: function() {},
    setScrollTop: function() {},
    clear: function() {}
  }, NullScrollbars.prototype);

  CodeMirror.scrollbarModel = {"native": NativeScrollbars, "null": NullScrollbars};

  function initScrollbars(cm) {
    if (cm.display.scrollbars) {
      cm.display.scrollbars.clear();
      if (cm.display.scrollbars.addClass)
        rmClass(cm.display.wrapper, cm.display.scrollbars.addClass);
    }

    cm.display.scrollbars = new CodeMirror.scrollbarModel[cm.options.scrollbarStyle](function(node) {
      cm.display.wrapper.insertBefore(node, cm.display.scrollbarFiller);
      on(node, "mousedown", function() {
        if (cm.state.focused) setTimeout(bind(focusInput, cm), 0);
      });
      node.setAttribute("not-content", "true");
    }, function(pos, axis) {
      if (axis == "horizontal") setScrollLeft(cm, pos);
      else setScrollTop(cm, pos);
    }, cm);
    if (cm.display.scrollbars.addClass)
      addClass(cm.display.wrapper, cm.display.scrollbars.addClass);
  }

  function updateScrollbars(cm, measure) {
    if (!measure) measure = measureForScrollbars(cm);
    var startWidth = cm.display.barWidth, startHeight = cm.display.barHeight;
    updateScrollbarsInner(cm, measure);
    for (var i = 0; i < 4 && startWidth != cm.display.barWidth || startHeight != cm.display.barHeight; i++) {
      if (startWidth != cm.display.barWidth && cm.options.lineWrapping)
        updateHeightsInViewport(cm);
      updateScrollbarsInner(cm, measureForScrollbars(cm));
      startWidth = cm.display.barWidth; startHeight = cm.display.barHeight;
    }
  }

  // Re-synchronize the fake scrollbars with the actual size of the
  // content.
  function updateScrollbarsInner(cm, measure) {
    var d = cm.display;
    var sizes = d.scrollbars.update(measure);

    d.sizer.style.paddingRight = (d.barWidth = sizes.right) + "px";
    d.sizer.style.paddingBottom = (d.barHeight = sizes.bottom) + "px";

    if (sizes.right && sizes.bottom) {
      d.scrollbarFiller.style.display = "block";
      d.scrollbarFiller.style.height = sizes.bottom + "px";
      d.scrollbarFiller.style.width = sizes.right + "px";
    } else d.scrollbarFiller.style.display = "";
    if (sizes.bottom && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
      d.gutterFiller.style.display = "block";
      d.gutterFiller.style.height = sizes.bottom + "px";
      d.gutterFiller.style.width = measure.gutterWidth + "px";
    } else d.gutterFiller.style.display = "";
  }

  // Compute the lines that are visible in a given viewport (defaults
  // the the current scroll position). viewport may contain top,
  // height, and ensure (see op.scrollToPos) properties.
  function visibleLines(display, doc, viewport) {
    var top = viewport && viewport.top != null ? Math.max(0, viewport.top) : display.scroller.scrollTop;
    top = Math.floor(top - paddingTop(display));
    var bottom = viewport && viewport.bottom != null ? viewport.bottom : top + display.wrapper.clientHeight;

    var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
    // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
    // forces those lines into the viewport (if possible).
    if (viewport && viewport.ensure) {
      var ensureFrom = viewport.ensure.from.line, ensureTo = viewport.ensure.to.line;
      if (ensureFrom < from) {
        from = ensureFrom;
        to = lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight);
      } else if (Math.min(ensureTo, doc.lastLine()) >= to) {
        from = lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight);
        to = ensureTo;
      }
    }
    return {from: from, to: Math.max(to, from + 1)};
  }

  // LINE NUMBERS

  // Re-align line numbers and gutter marks to compensate for
  // horizontal scrolling.
  function alignHorizontally(cm) {
    var display = cm.display, view = display.view;
    if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
    var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
    var gutterW = display.gutters.offsetWidth, left = comp + "px";
    for (var i = 0; i < view.length; i++) if (!view[i].hidden) {
      if (cm.options.fixedGutter && view[i].gutter)
        view[i].gutter.style.left = left;
      var align = view[i].alignable;
      if (align) for (var j = 0; j < align.length; j++)
        align[j].style.left = left;
    }
    if (cm.options.fixedGutter)
      display.gutters.style.left = (comp + gutterW) + "px";
  }

  // Used to ensure that the line number gutter is still the right
  // size for the current document size. Returns true when an update
  // is needed.
  function maybeUpdateLineNumberWidth(cm) {
    if (!cm.options.lineNumbers) return false;
    var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
    if (last.length != display.lineNumChars) {
      var test = display.measure.appendChild(elt("div", [elt("div", last)],
                                                 "CodeMirror-linenumber CodeMirror-gutter-elt"));
      var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
      display.lineGutter.style.width = "";
      display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding);
      display.lineNumWidth = display.lineNumInnerWidth + padding;
      display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
      display.lineGutter.style.width = display.lineNumWidth + "px";
      updateGutterSpace(cm);
      return true;
    }
    return false;
  }

  function lineNumberFor(options, i) {
    return String(options.lineNumberFormatter(i + options.firstLineNumber));
  }

  // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
  // but using getBoundingClientRect to get a sub-pixel-accurate
  // result.
  function compensateForHScroll(display) {
    return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left;
  }

  // DISPLAY DRAWING

  function DisplayUpdate(cm, viewport, force) {
    var display = cm.display;

    this.viewport = viewport;
    // Store some values that we'll need later (but don't want to force a relayout for)
    this.visible = visibleLines(display, cm.doc, viewport);
    this.editorIsHidden = !display.wrapper.offsetWidth;
    this.wrapperHeight = display.wrapper.clientHeight;
    this.wrapperWidth = display.wrapper.clientWidth;
    this.oldDisplayWidth = displayWidth(cm);
    this.force = force;
    this.dims = getDimensions(cm);
  }

  function maybeClipScrollbars(cm) {
    var display = cm.display;
    if (!display.scrollbarsClipped && display.scroller.offsetWidth) {
      display.nativeBarWidth = display.scroller.offsetWidth - display.scroller.clientWidth;
      display.heightForcer.style.height = scrollGap(cm) + "px";
      display.sizer.style.marginBottom = -display.nativeBarWidth + "px";
      display.sizer.style.borderRightWidth = scrollGap(cm) + "px";
      display.scrollbarsClipped = true;
    }
  }

  // Does the actual updating of the line display. Bails out
  // (returning false) when there is nothing to be done and forced is
  // false.
  function updateDisplayIfNeeded(cm, update) {
    var display = cm.display, doc = cm.doc;

    if (update.editorIsHidden) {
      resetView(cm);
      return false;
    }

    // Bail out if the visible area is already rendered and nothing changed.
    if (!update.force &&
        update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
        display.renderedView == display.view && countDirtyView(cm) == 0)
      return false;

    if (maybeUpdateLineNumberWidth(cm)) {
      resetView(cm);
      update.dims = getDimensions(cm);
    }

    // Compute a suitable new viewport (from & to)
    var end = doc.first + doc.size;
    var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
    var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
    if (display.viewFrom < from && from - display.viewFrom < 20) from = Math.max(doc.first, display.viewFrom);
    if (display.viewTo > to && display.viewTo - to < 20) to = Math.min(end, display.viewTo);
    if (sawCollapsedSpans) {
      from = visualLineNo(cm.doc, from);
      to = visualLineEndNo(cm.doc, to);
    }

    var different = from != display.viewFrom || to != display.viewTo ||
      display.lastWrapHeight != update.wrapperHeight || display.lastWrapWidth != update.wrapperWidth;
    adjustView(cm, from, to);

    display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
    // Position the mover div to align with the current scroll position
    cm.display.mover.style.top = display.viewOffset + "px";

    var toUpdate = countDirtyView(cm);
    if (!different && toUpdate == 0 && !update.force && display.renderedView == display.view &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
      return false;

    // For big changes, we hide the enclosing element during the
    // update, since that speeds up the operations on most browsers.
    var focused = activeElt();
    if (toUpdate > 4) display.lineDiv.style.display = "none";
    patchDisplay(cm, display.updateLineNumbers, update.dims);
    if (toUpdate > 4) display.lineDiv.style.display = "";
    display.renderedView = display.view;
    // There might have been a widget with a focused element that got
    // hidden or updated, if so re-focus it.
    if (focused && activeElt() != focused && focused.offsetHeight) focused.focus();

    // Prevent selection and cursors from interfering with the scroll
    // width and height.
    removeChildren(display.cursorDiv);
    removeChildren(display.selectionDiv);
    display.gutters.style.height = 0;

    if (different) {
      display.lastWrapHeight = update.wrapperHeight;
      display.lastWrapWidth = update.wrapperWidth;
      startWorker(cm, 400);
    }

    display.updateLineNumbers = null;

    return true;
  }

  function postUpdateDisplay(cm, update) {
    var force = update.force, viewport = update.viewport;
    for (var first = true;; first = false) {
      if (first && cm.options.lineWrapping && update.oldDisplayWidth != displayWidth(cm)) {
        force = true;
      } else {
        force = false;
        // Clip forced viewport to actual scrollable area.
        if (viewport && viewport.top != null)
          viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - displayHeight(cm), viewport.top)};
        // Updated line heights might result in the drawn area not
        // actually covering the viewport. Keep looping until it does.
        update.visible = visibleLines(cm.display, cm.doc, viewport);
        if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
          break;
      }
      if (!updateDisplayIfNeeded(cm, update)) break;
      updateHeightsInViewport(cm);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }

    signalLater(cm, "update", cm);
    if (cm.display.viewFrom != cm.display.reportedViewFrom || cm.display.viewTo != cm.display.reportedViewTo) {
      signalLater(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
      cm.display.reportedViewFrom = cm.display.viewFrom; cm.display.reportedViewTo = cm.display.viewTo;
    }
  }

  function updateDisplaySimple(cm, viewport) {
    var update = new DisplayUpdate(cm, viewport);
    if (updateDisplayIfNeeded(cm, update)) {
      updateHeightsInViewport(cm);
      postUpdateDisplay(cm, update);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }
  }

  function setDocumentHeight(cm, measure) {
    cm.display.sizer.style.minHeight = measure.docHeight + "px";
    var total = measure.docHeight + cm.display.barHeight;
    cm.display.heightForcer.style.top = total + "px";
    cm.display.gutters.style.height = Math.max(total + scrollGap(cm), measure.clientHeight) + "px";
  }

  // Read the actual heights of the rendered lines, and update their
  // stored heights to match.
  function updateHeightsInViewport(cm) {
    var display = cm.display;
    var prevBottom = display.lineDiv.offsetTop;
    for (var i = 0; i < display.view.length; i++) {
      var cur = display.view[i], height;
      if (cur.hidden) continue;
      if (ie && ie_version < 8) {
        var bot = cur.node.offsetTop + cur.node.offsetHeight;
        height = bot - prevBottom;
        prevBottom = bot;
      } else {
        var box = cur.node.getBoundingClientRect();
        height = box.bottom - box.top;
      }
      var diff = cur.line.height - height;
      if (height < 2) height = textHeight(display);
      if (diff > .001 || diff < -.001) {
        updateLineHeight(cur.line, height);
        updateWidgetHeight(cur.line);
        if (cur.rest) for (var j = 0; j < cur.rest.length; j++)
          updateWidgetHeight(cur.rest[j]);
      }
    }
  }

  // Read and store the height of line widgets associated with the
  // given line.
  function updateWidgetHeight(line) {
    if (line.widgets) for (var i = 0; i < line.widgets.length; ++i)
      line.widgets[i].height = line.widgets[i].node.offsetHeight;
  }

  // Do a bulk-read of the DOM positions and sizes needed to draw the
  // view, so that we don't interleave reading and writing to the DOM.
  function getDimensions(cm) {
    var d = cm.display, left = {}, width = {};
    var gutterLeft = d.gutters.clientLeft;
    for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
      left[cm.options.gutters[i]] = n.offsetLeft + n.clientLeft + gutterLeft;
      width[cm.options.gutters[i]] = n.clientWidth;
    }
    return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
  }

  // Sync the actual display DOM structure with display.view, removing
  // nodes for lines that are no longer in view, and creating the ones
  // that are not there yet, and updating the ones that are out of
  // date.
  function patchDisplay(cm, updateNumbersFrom, dims) {
    var display = cm.display, lineNumbers = cm.options.lineNumbers;
    var container = display.lineDiv, cur = container.firstChild;

    function rm(node) {
      var next = node.nextSibling;
      // Works around a throw-scroll bug in OS X Webkit
      if (webkit && mac && cm.display.currentWheelTarget == node)
        node.style.display = "none";
      else
        node.parentNode.removeChild(node);
      return next;
    }

    var view = display.view, lineN = display.viewFrom;
    // Loop over the elements in the view, syncing cur (the DOM nodes
    // in display.lineDiv) with the view as we go.
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (lineView.hidden) {
      } else if (!lineView.node) { // Not drawn yet
        var node = buildLineElement(cm, lineView, lineN, dims);
        container.insertBefore(node, cur);
      } else { // Already drawn
        while (cur != lineView.node) cur = rm(cur);
        var updateNumber = lineNumbers && updateNumbersFrom != null &&
          updateNumbersFrom <= lineN && lineView.lineNumber;
        if (lineView.changes) {
          if (indexOf(lineView.changes, "gutter") > -1) updateNumber = false;
          updateLineForChanges(cm, lineView, lineN, dims);
        }
        if (updateNumber) {
          removeChildren(lineView.lineNumber);
          lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
        }
        cur = lineView.node.nextSibling;
      }
      lineN += lineView.size;
    }
    while (cur) cur = rm(cur);
  }

  // When an aspect of a line changes, a string is added to
  // lineView.changes. This updates the relevant part of the line's
  // DOM structure.
  function updateLineForChanges(cm, lineView, lineN, dims) {
    for (var j = 0; j < lineView.changes.length; j++) {
      var type = lineView.changes[j];
      if (type == "text") updateLineText(cm, lineView);
      else if (type == "gutter") updateLineGutter(cm, lineView, lineN, dims);
      else if (type == "class") updateLineClasses(lineView);
      else if (type == "widget") updateLineWidgets(lineView, dims);
    }
    lineView.changes = null;
  }

  // Lines with gutter elements, widgets or a background class need to
  // be wrapped, and have the extra elements added to the wrapper div
  function ensureLineWrapped(lineView) {
    if (lineView.node == lineView.text) {
      lineView.node = elt("div", null, null, "position: relative");
      if (lineView.text.parentNode)
        lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
      lineView.node.appendChild(lineView.text);
      if (ie && ie_version < 8) lineView.node.style.zIndex = 2;
    }
    return lineView.node;
  }

  function updateLineBackground(lineView) {
    var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
    if (cls) cls += " CodeMirror-linebackground";
    if (lineView.background) {
      if (cls) lineView.background.className = cls;
      else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
    } else if (cls) {
      var wrap = ensureLineWrapped(lineView);
      lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
    }
  }

  // Wrapper around buildLineContent which will reuse the structure
  // in display.externalMeasured when possible.
  function getLineContent(cm, lineView) {
    var ext = cm.display.externalMeasured;
    if (ext && ext.line == lineView.line) {
      cm.display.externalMeasured = null;
      lineView.measure = ext.measure;
      return ext.built;
    }
    return buildLineContent(cm, lineView);
  }

  // Redraw the line's text. Interacts with the background and text
  // classes because the mode may output tokens that influence these
  // classes.
  function updateLineText(cm, lineView) {
    var cls = lineView.text.className;
    var built = getLineContent(cm, lineView);
    if (lineView.text == lineView.node) lineView.node = built.pre;
    lineView.text.parentNode.replaceChild(built.pre, lineView.text);
    lineView.text = built.pre;
    if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
      lineView.bgClass = built.bgClass;
      lineView.textClass = built.textClass;
      updateLineClasses(lineView);
    } else if (cls) {
      lineView.text.className = cls;
    }
  }

  function updateLineClasses(lineView) {
    updateLineBackground(lineView);
    if (lineView.line.wrapClass)
      ensureLineWrapped(lineView).className = lineView.line.wrapClass;
    else if (lineView.node != lineView.text)
      lineView.node.className = "";
    var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
    lineView.text.className = textClass || "";
  }

  function updateLineGutter(cm, lineView, lineN, dims) {
    if (lineView.gutter) {
      lineView.node.removeChild(lineView.gutter);
      lineView.gutter = null;
    }
    var markers = lineView.line.gutterMarkers;
    if (cm.options.lineNumbers || markers) {
      var wrap = ensureLineWrapped(lineView);
      var gutterWrap = lineView.gutter =
        wrap.insertBefore(elt("div", null, "CodeMirror-gutter-wrapper", "left: " +
                              (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) +
                              "px; width: " + dims.gutterTotalWidth + "px"),
                          lineView.text);
      if (lineView.line.gutterClass)
        gutterWrap.className += " " + lineView.line.gutterClass;
      if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
        lineView.lineNumber = gutterWrap.appendChild(
          elt("div", lineNumberFor(cm.options, lineN),
              "CodeMirror-linenumber CodeMirror-gutter-elt",
              "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
              + cm.display.lineNumInnerWidth + "px"));
      if (markers) for (var k = 0; k < cm.options.gutters.length; ++k) {
        var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
        if (found)
          gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                     dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
      }
    }
  }

  function updateLineWidgets(lineView, dims) {
    if (lineView.alignable) lineView.alignable = null;
    for (var node = lineView.node.firstChild, next; node; node = next) {
      var next = node.nextSibling;
      if (node.className == "CodeMirror-linewidget")
        lineView.node.removeChild(node);
    }
    insertLineWidgets(lineView, dims);
  }

  // Build a line's DOM representation from scratch
  function buildLineElement(cm, lineView, lineN, dims) {
    var built = getLineContent(cm, lineView);
    lineView.text = lineView.node = built.pre;
    if (built.bgClass) lineView.bgClass = built.bgClass;
    if (built.textClass) lineView.textClass = built.textClass;

    updateLineClasses(lineView);
    updateLineGutter(cm, lineView, lineN, dims);
    insertLineWidgets(lineView, dims);
    return lineView.node;
  }

  // A lineView may contain multiple logical lines (when merged by
  // collapsed spans). The widgets for all of them need to be drawn.
  function insertLineWidgets(lineView, dims) {
    insertLineWidgetsFor(lineView.line, lineView, dims, true);
    if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
      insertLineWidgetsFor(lineView.rest[i], lineView, dims, false);
  }

  function insertLineWidgetsFor(line, lineView, dims, allowAbove) {
    if (!line.widgets) return;
    var wrap = ensureLineWrapped(lineView);
    for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
      var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
      if (!widget.handleMouseEvents) node.setAttribute("cm-ignore-events", "true");
      positionLineWidget(widget, node, lineView, dims);
      if (allowAbove && widget.above)
        wrap.insertBefore(node, lineView.gutter || lineView.text);
      else
        wrap.appendChild(node);
      signalLater(widget, "redraw");
    }
  }

  function positionLineWidget(widget, node, lineView, dims) {
    if (widget.noHScroll) {
      (lineView.alignable || (lineView.alignable = [])).push(node);
      var width = dims.wrapperWidth;
      node.style.left = dims.fixedPos + "px";
      if (!widget.coverGutter) {
        width -= dims.gutterTotalWidth;
        node.style.paddingLeft = dims.gutterTotalWidth + "px";
      }
      node.style.width = width + "px";
    }
    if (widget.coverGutter) {
      node.style.zIndex = 5;
      node.style.position = "relative";
      if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
    }
  }

  // POSITION OBJECT

  // A Pos instance represents a position within the text.
  var Pos = CodeMirror.Pos = function(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  };

  // Compare two positions, return 0 if they are the same, a negative
  // number when a is less, and a positive number otherwise.
  var cmp = CodeMirror.cmpPos = function(a, b) { return a.line - b.line || a.ch - b.ch; };

  function copyPos(x) {return Pos(x.line, x.ch);}
  function maxPos(a, b) { return cmp(a, b) < 0 ? b : a; }
  function minPos(a, b) { return cmp(a, b) < 0 ? a : b; }

  // SELECTION / CURSOR

  // Selection objects are immutable. A new one is created every time
  // the selection changes. A selection is one or more non-overlapping
  // (and non-touching) ranges, sorted, and an integer that indicates
  // which one is the primary selection (the one that's scrolled into
  // view, that getCursor returns, etc).
  function Selection(ranges, primIndex) {
    this.ranges = ranges;
    this.primIndex = primIndex;
  }

  Selection.prototype = {
    primary: function() { return this.ranges[this.primIndex]; },
    equals: function(other) {
      if (other == this) return true;
      if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return false;
      for (var i = 0; i < this.ranges.length; i++) {
        var here = this.ranges[i], there = other.ranges[i];
        if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0) return false;
      }
      return true;
    },
    deepCopy: function() {
      for (var out = [], i = 0; i < this.ranges.length; i++)
        out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
      return new Selection(out, this.primIndex);
    },
    somethingSelected: function() {
      for (var i = 0; i < this.ranges.length; i++)
        if (!this.ranges[i].empty()) return true;
      return false;
    },
    contains: function(pos, end) {
      if (!end) end = pos;
      for (var i = 0; i < this.ranges.length; i++) {
        var range = this.ranges[i];
        if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
          return i;
      }
      return -1;
    }
  };

  function Range(anchor, head) {
    this.anchor = anchor; this.head = head;
  }

  Range.prototype = {
    from: function() { return minPos(this.anchor, this.head); },
    to: function() { return maxPos(this.anchor, this.head); },
    empty: function() {
      return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
    }
  };

  // Take an unsorted, potentially overlapping set of ranges, and
  // build a selection out of it. 'Consumes' ranges array (modifying
  // it).
  function normalizeSelection(ranges, primIndex) {
    var prim = ranges[primIndex];
    ranges.sort(function(a, b) { return cmp(a.from(), b.from()); });
    primIndex = indexOf(ranges, prim);
    for (var i = 1; i < ranges.length; i++) {
      var cur = ranges[i], prev = ranges[i - 1];
      if (cmp(prev.to(), cur.from()) >= 0) {
        var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
        var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
        if (i <= primIndex) --primIndex;
        ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
      }
    }
    return new Selection(ranges, primIndex);
  }

  function simpleSelection(anchor, head) {
    return new Selection([new Range(anchor, head || anchor)], 0);
  }

  // Most of the external API clips given positions to make sure they
  // actually exist within the document.
  function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
  function clipPos(doc, pos) {
    if (pos.line < doc.first) return Pos(doc.first, 0);
    var last = doc.first + doc.size - 1;
    if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
    return clipToLen(pos, getLine(doc, pos.line).text.length);
  }
  function clipToLen(pos, linelen) {
    var ch = pos.ch;
    if (ch == null || ch > linelen) return Pos(pos.line, linelen);
    else if (ch < 0) return Pos(pos.line, 0);
    else return pos;
  }
  function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}
  function clipPosArray(doc, array) {
    for (var out = [], i = 0; i < array.length; i++) out[i] = clipPos(doc, array[i]);
    return out;
  }

  // SELECTION UPDATES

  // The 'scroll' parameter given to many of these indicated whether
  // the new cursor position should be scrolled into view after
  // modifying the selection.

  // If shift is held or the extend flag is set, extends a range to
  // include a given position (and optionally a second position).
  // Otherwise, simply returns the range between the given positions.
  // Used for cursor motion and such.
  function extendRange(doc, range, head, other) {
    if (doc.cm && doc.cm.display.shift || doc.extend) {
      var anchor = range.anchor;
      if (other) {
        var posBefore = cmp(head, anchor) < 0;
        if (posBefore != (cmp(other, anchor) < 0)) {
          anchor = head;
          head = other;
        } else if (posBefore != (cmp(head, other) < 0)) {
          head = other;
        }
      }
      return new Range(anchor, head);
    } else {
      return new Range(other || head, head);
    }
  }

  // Extend the primary selection range, discard the rest.
  function extendSelection(doc, head, other, options) {
    setSelection(doc, new Selection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
  }

  // Extend all selections (pos is an array of selections with length
  // equal the number of selections)
  function extendSelections(doc, heads, options) {
    for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
      out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
    var newSel = normalizeSelection(out, doc.sel.primIndex);
    setSelection(doc, newSel, options);
  }

  // Updates a single range in the selection.
  function replaceOneSelection(doc, i, range, options) {
    var ranges = doc.sel.ranges.slice(0);
    ranges[i] = range;
    setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
  }

  // Reset the selection to a single range.
  function setSimpleSelection(doc, anchor, head, options) {
    setSelection(doc, simpleSelection(anchor, head), options);
  }

  // Give beforeSelectionChange handlers a change to influence a
  // selection update.
  function filterSelectionChange(doc, sel) {
    var obj = {
      ranges: sel.ranges,
      update: function(ranges) {
        this.ranges = [];
        for (var i = 0; i < ranges.length; i++)
          this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                                     clipPos(doc, ranges[i].head));
      }
    };
    signal(doc, "beforeSelectionChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
    if (obj.ranges != sel.ranges) return normalizeSelection(obj.ranges, obj.ranges.length - 1);
    else return sel;
  }

  function setSelectionReplaceHistory(doc, sel, options) {
    var done = doc.history.done, last = lst(done);
    if (last && last.ranges) {
      done[done.length - 1] = sel;
      setSelectionNoUndo(doc, sel, options);
    } else {
      setSelection(doc, sel, options);
    }
  }

  // Set a new selection.
  function setSelection(doc, sel, options) {
    setSelectionNoUndo(doc, sel, options);
    addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
  }

  function setSelectionNoUndo(doc, sel, options) {
    if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
      sel = filterSelectionChange(doc, sel);

    var bias = options && options.bias ||
      (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
    setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

    if (!(options && options.scroll === false) && doc.cm)
      ensureCursorVisible(doc.cm);
  }

  function setSelectionInner(doc, sel) {
    if (sel.equals(doc.sel)) return;

    doc.sel = sel;

    if (doc.cm) {
      doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
      signalCursorActivity(doc.cm);
    }
    signalLater(doc, "cursorActivity", doc);
  }

  // Verify that the selection does not partially select any atomic
  // marked ranges.
  function reCheckSelection(doc) {
    setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
  }

  // Return a selection that does not partially select any atomic
  // ranges.
  function skipAtomicInSelection(doc, sel, bias, mayClear) {
    var out;
    for (var i = 0; i < sel.ranges.length; i++) {
      var range = sel.ranges[i];
      var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
      var newHead = skipAtomic(doc, range.head, bias, mayClear);
      if (out || newAnchor != range.anchor || newHead != range.head) {
        if (!out) out = sel.ranges.slice(0, i);
        out[i] = new Range(newAnchor, newHead);
      }
    }
    return out ? normalizeSelection(out, sel.primIndex) : sel;
  }

  // Ensure a given position is not inside an atomic range.
  function skipAtomic(doc, pos, bias, mayClear) {
    var flipped = false, curPos = pos;
    var dir = bias || 1;
    doc.cantEdit = false;
    search: for (;;) {
      var line = getLine(doc, curPos.line);
      if (line.markedSpans) {
        for (var i = 0; i < line.markedSpans.length; ++i) {
          var sp = line.markedSpans[i], m = sp.marker;
          if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
              (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
            if (mayClear) {
              signal(m, "beforeCursorEnter");
              if (m.explicitlyCleared) {
                if (!line.markedSpans) break;
                else {--i; continue;}
              }
            }
            if (!m.atomic) continue;
            var newPos = m.find(dir < 0 ? -1 : 1);
            if (cmp(newPos, curPos) == 0) {
              newPos.ch += dir;
              if (newPos.ch < 0) {
                if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                else newPos = null;
              } else if (newPos.ch > line.text.length) {
                if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                else newPos = null;
              }
              if (!newPos) {
                if (flipped) {
                  // Driven in a corner -- no valid cursor position found at all
                  // -- try again *with* clearing, if we didn't already
                  if (!mayClear) return skipAtomic(doc, pos, bias, true);
                  // Otherwise, turn off editing until further notice, and return the start of the doc
                  doc.cantEdit = true;
                  return Pos(doc.first, 0);
                }
                flipped = true; newPos = pos; dir = -dir;
              }
            }
            curPos = newPos;
            continue search;
          }
        }
      }
      return curPos;
    }
  }

  // SELECTION DRAWING

  // Redraw the selection and/or cursor
  function drawSelection(cm) {
    var display = cm.display, doc = cm.doc, result = {};
    var curFragment = result.cursors = document.createDocumentFragment();
    var selFragment = result.selection = document.createDocumentFragment();

    for (var i = 0; i < doc.sel.ranges.length; i++) {
      var range = doc.sel.ranges[i];
      var collapsed = range.empty();
      if (collapsed || cm.options.showCursorWhenSelecting)
        drawSelectionCursor(cm, range, curFragment);
      if (!collapsed)
        drawSelectionRange(cm, range, selFragment);
    }

    // Move the hidden textarea near the cursor to prevent scrolling artifacts
    if (cm.options.moveInputWithCursor) {
      var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
      var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
      result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                          headPos.top + lineOff.top - wrapOff.top));
      result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                           headPos.left + lineOff.left - wrapOff.left));
    }

    return result;
  }

  function showSelection(cm, drawn) {
    removeChildrenAndAdd(cm.display.cursorDiv, drawn.cursors);
    removeChildrenAndAdd(cm.display.selectionDiv, drawn.selection);
    if (drawn.teTop != null) {
      cm.display.inputDiv.style.top = drawn.teTop + "px";
      cm.display.inputDiv.style.left = drawn.teLeft + "px";
    }
  }

  function updateSelection(cm) {
    showSelection(cm, drawSelection(cm));
  }

  // Draws a cursor for the given range
  function drawSelectionCursor(cm, range, output) {
    var pos = cursorCoords(cm, range.head, "div", null, null, !cm.options.singleCursorHeightPerLine);

    var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
    cursor.style.left = pos.left + "px";
    cursor.style.top = pos.top + "px";
    cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

    if (pos.other) {
      // Secondary cursor, shown when on a 'jump' in bi-directional text
      var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
      otherCursor.style.display = "";
      otherCursor.style.left = pos.other.left + "px";
      otherCursor.style.top = pos.other.top + "px";
      otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
    }
  }

  // Draws the given range as a highlighted selection
  function drawSelectionRange(cm, range, output) {
    var display = cm.display, doc = cm.doc;
    var fragment = document.createDocumentFragment();
    var padding = paddingH(cm.display), leftSide = padding.left;
    var rightSide = Math.max(display.sizerWidth, displayWidth(cm) - display.sizer.offsetLeft) - padding.right;

    function add(left, top, width, bottom) {
      if (top < 0) top = 0;
      top = Math.round(top);
      bottom = Math.round(bottom);
      fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                               "px; top: " + top + "px; width: " + (width == null ? rightSide - left : width) +
                               "px; height: " + (bottom - top) + "px"));
    }

    function drawForLine(line, fromArg, toArg) {
      var lineObj = getLine(doc, line);
      var lineLen = lineObj.text.length;
      var start, end;
      function coords(ch, bias) {
        return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
      }

      iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
        var leftPos = coords(from, "left"), rightPos, left, right;
        if (from == to) {
          rightPos = leftPos;
          left = right = leftPos.left;
        } else {
          rightPos = coords(to - 1, "right");
          if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
          left = leftPos.left;
          right = rightPos.right;
        }
        if (fromArg == null && from == 0) left = leftSide;
        if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
          add(left, leftPos.top, null, leftPos.bottom);
          left = leftSide;
          if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
        }
        if (toArg == null && to == lineLen) right = rightSide;
        if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
          start = leftPos;
        if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
          end = rightPos;
        if (left < leftSide + 1) left = leftSide;
        add(left, rightPos.top, right - left, rightPos.bottom);
      });
      return {start: start, end: end};
    }

    var sFrom = range.from(), sTo = range.to();
    if (sFrom.line == sTo.line) {
      drawForLine(sFrom.line, sFrom.ch, sTo.ch);
    } else {
      var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
      var singleVLine = visualLine(fromLine) == visualLine(toLine);
      var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
      var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
      if (singleVLine) {
        if (leftEnd.top < rightStart.top - 2) {
          add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
          add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
        } else {
          add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
        }
      }
      if (leftEnd.bottom < rightStart.top)
        add(leftSide, leftEnd.bottom, null, rightStart.top);
    }

    output.appendChild(fragment);
  }

  // Cursor-blinking
  function restartBlink(cm) {
    if (!cm.state.focused) return;
    var display = cm.display;
    clearInterval(display.blinker);
    var on = true;
    display.cursorDiv.style.visibility = "";
    if (cm.options.cursorBlinkRate > 0)
      display.blinker = setInterval(function() {
        display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
      }, cm.options.cursorBlinkRate);
    else if (cm.options.cursorBlinkRate < 0)
      display.cursorDiv.style.visibility = "hidden";
  }

  // HIGHLIGHT WORKER

  function startWorker(cm, time) {
    if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
      cm.state.highlight.set(time, bind(highlightWorker, cm));
  }

  function highlightWorker(cm) {
    var doc = cm.doc;
    if (doc.frontier < doc.first) doc.frontier = doc.first;
    if (doc.frontier >= cm.display.viewTo) return;
    var end = +new Date + cm.options.workTime;
    var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
    var changedLines = [];

    doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function(line) {
      if (doc.frontier >= cm.display.viewFrom) { // Visible
        var oldStyles = line.styles;
        var highlighted = highlightLine(cm, line, state, true);
        line.styles = highlighted.styles;
        var oldCls = line.styleClasses, newCls = highlighted.classes;
        if (newCls) line.styleClasses = newCls;
        else if (oldCls) line.styleClasses = null;
        var ischange = !oldStyles || oldStyles.length != line.styles.length ||
          oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
        for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
        if (ischange) changedLines.push(doc.frontier);
        line.stateAfter = copyState(doc.mode, state);
      } else {
        processLine(cm, line.text, state);
        line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
      }
      ++doc.frontier;
      if (+new Date > end) {
        startWorker(cm, cm.options.workDelay);
        return true;
      }
    });
    if (changedLines.length) runInOp(cm, function() {
      for (var i = 0; i < changedLines.length; i++)
        regLineChange(cm, changedLines[i], "text");
    });
  }

  // Finds the line to start with when starting a parse. Tries to
  // find a line with a stateAfter, so that it can start with a
  // valid state. If that fails, it returns the line with the
  // smallest indentation, which tends to need the least context to
  // parse correctly.
  function findStartLine(cm, n, precise) {
    var minindent, minline, doc = cm.doc;
    var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
    for (var search = n; search > lim; --search) {
      if (search <= doc.first) return doc.first;
      var line = getLine(doc, search - 1);
      if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
      var indented = countColumn(line.text, null, cm.options.tabSize);
      if (minline == null || minindent > indented) {
        minline = search - 1;
        minindent = indented;
      }
    }
    return minline;
  }

  function getStateBefore(cm, n, precise) {
    var doc = cm.doc, display = cm.display;
    if (!doc.mode.startState) return true;
    var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
    if (!state) state = startState(doc.mode);
    else state = copyState(doc.mode, state);
    doc.iter(pos, n, function(line) {
      processLine(cm, line.text, state);
      var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
      line.stateAfter = save ? copyState(doc.mode, state) : null;
      ++pos;
    });
    if (precise) doc.frontier = pos;
    return state;
  }

  // POSITION MEASUREMENT

  function paddingTop(display) {return display.lineSpace.offsetTop;}
  function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
  function paddingH(display) {
    if (display.cachedPaddingH) return display.cachedPaddingH;
    var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
    var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
    var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
    if (!isNaN(data.left) && !isNaN(data.right)) display.cachedPaddingH = data;
    return data;
  }

  function scrollGap(cm) { return scrollerGap - cm.display.nativeBarWidth; }
  function displayWidth(cm) {
    return cm.display.scroller.clientWidth - scrollGap(cm) - cm.display.barWidth;
  }
  function displayHeight(cm) {
    return cm.display.scroller.clientHeight - scrollGap(cm) - cm.display.barHeight;
  }

  // Ensure the lineView.wrapping.heights array is populated. This is
  // an array of bottom offsets for the lines that make up a drawn
  // line. When lineWrapping is on, there might be more than one
  // height.
  function ensureLineHeights(cm, lineView, rect) {
    var wrapping = cm.options.lineWrapping;
    var curWidth = wrapping && displayWidth(cm);
    if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
      var heights = lineView.measure.heights = [];
      if (wrapping) {
        lineView.measure.width = curWidth;
        var rects = lineView.text.firstChild.getClientRects();
        for (var i = 0; i < rects.length - 1; i++) {
          var cur = rects[i], next = rects[i + 1];
          if (Math.abs(cur.bottom - next.bottom) > 2)
            heights.push((cur.bottom + next.top) / 2 - rect.top);
        }
      }
      heights.push(rect.bottom - rect.top);
    }
  }

  // Find a line map (mapping character offsets to text nodes) and a
  // measurement cache for the given line number. (A line view might
  // contain multiple lines when collapsed ranges are present.)
  function mapFromLineView(lineView, line, lineN) {
    if (lineView.line == line)
      return {map: lineView.measure.map, cache: lineView.measure.cache};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineView.rest[i] == line)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineNo(lineView.rest[i]) > lineN)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
  }

  // Render a line into the hidden node display.externalMeasured. Used
  // when measurement is needed for a line that's not in the viewport.
  function updateExternalMeasurement(cm, line) {
    line = visualLine(line);
    var lineN = lineNo(line);
    var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
    view.lineN = lineN;
    var built = view.built = buildLineContent(cm, view);
    view.text = built.pre;
    removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
    return view;
  }

  // Get a {top, bottom, left, right} box (in line-local coordinates)
  // for a given character.
  function measureChar(cm, line, ch, bias) {
    return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
  }

  // Find a line view that corresponds to the given line number.
  function findViewForLine(cm, lineN) {
    if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
      return cm.display.view[findViewIndex(cm, lineN)];
    var ext = cm.display.externalMeasured;
    if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
      return ext;
  }

  // Measurement can be split in two steps, the set-up work that
  // applies to the whole line, and the measurement of the actual
  // character. Functions like coordsChar, that need to do a lot of
  // measurements in a row, can thus ensure that the set-up work is
  // only done once.
  function prepareMeasureForLine(cm, line) {
    var lineN = lineNo(line);
    var view = findViewForLine(cm, lineN);
    if (view && !view.text)
      view = null;
    else if (view && view.changes)
      updateLineForChanges(cm, view, lineN, getDimensions(cm));
    if (!view)
      view = updateExternalMeasurement(cm, line);

    var info = mapFromLineView(view, line, lineN);
    return {
      line: line, view: view, rect: null,
      map: info.map, cache: info.cache, before: info.before,
      hasHeights: false
    };
  }

  // Given a prepared measurement object, measures the position of an
  // actual character (or fetches it from the cache).
  function measureCharPrepared(cm, prepared, ch, bias, varHeight) {
    if (prepared.before) ch = -1;
    var key = ch + (bias || ""), found;
    if (prepared.cache.hasOwnProperty(key)) {
      found = prepared.cache[key];
    } else {
      if (!prepared.rect)
        prepared.rect = prepared.view.text.getBoundingClientRect();
      if (!prepared.hasHeights) {
        ensureLineHeights(cm, prepared.view, prepared.rect);
        prepared.hasHeights = true;
      }
      found = measureCharInner(cm, prepared, ch, bias);
      if (!found.bogus) prepared.cache[key] = found;
    }
    return {left: found.left, right: found.right,
            top: varHeight ? found.rtop : found.top,
            bottom: varHeight ? found.rbottom : found.bottom};
  }

  var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

  function measureCharInner(cm, prepared, ch, bias) {
    var map = prepared.map;

    var node, start, end, collapse;
    // First, search the line map for the text node corresponding to,
    // or closest to, the target character.
    for (var i = 0; i < map.length; i += 3) {
      var mStart = map[i], mEnd = map[i + 1];
      if (ch < mStart) {
        start = 0; end = 1;
        collapse = "left";
      } else if (ch < mEnd) {
        start = ch - mStart;
        end = start + 1;
      } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
        end = mEnd - mStart;
        start = end - 1;
        if (ch >= mEnd) collapse = "right";
      }
      if (start != null) {
        node = map[i + 2];
        if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
          collapse = bias;
        if (bias == "left" && start == 0)
          while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
            node = map[(i -= 3) + 2];
            collapse = "left";
          }
        if (bias == "right" && start == mEnd - mStart)
          while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
            node = map[(i += 3) + 2];
            collapse = "right";
          }
        break;
      }
    }

    var rect;
    if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
      for (var i = 0; i < 4; i++) { // Retry a maximum of 4 times when nonsense rectangles are returned
        while (start && isExtendingChar(prepared.line.text.charAt(mStart + start))) --start;
        while (mStart + end < mEnd && isExtendingChar(prepared.line.text.charAt(mStart + end))) ++end;
        if (ie && ie_version < 9 && start == 0 && end == mEnd - mStart) {
          rect = node.parentNode.getBoundingClientRect();
        } else if (ie && cm.options.lineWrapping) {
          var rects = range(node, start, end).getClientRects();
          if (rects.length)
            rect = rects[bias == "right" ? rects.length - 1 : 0];
          else
            rect = nullRect;
        } else {
          rect = range(node, start, end).getBoundingClientRect() || nullRect;
        }
        if (rect.left || rect.right || start == 0) break;
        end = start;
        start = start - 1;
        collapse = "right";
      }
      if (ie && ie_version < 11) rect = maybeUpdateRectForZooming(cm.display.measure, rect);
    } else { // If it is a widget, simply get the box for the whole widget.
      if (start > 0) collapse = bias = "right";
      var rects;
      if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
        rect = rects[bias == "right" ? rects.length - 1 : 0];
      else
        rect = node.getBoundingClientRect();
    }
    if (ie && ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
      var rSpan = node.parentNode.getClientRects()[0];
      if (rSpan)
        rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
      else
        rect = nullRect;
    }

    var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
    var mid = (rtop + rbot) / 2;
    var heights = prepared.view.measure.heights;
    for (var i = 0; i < heights.length - 1; i++)
      if (mid < heights[i]) break;
    var top = i ? heights[i - 1] : 0, bot = heights[i];
    var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
                  right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
                  top: top, bottom: bot};
    if (!rect.left && !rect.right) result.bogus = true;
    if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

    return result;
  }

  // Work around problem with bounding client rects on ranges being
  // returned incorrectly when zoomed on IE10 and below.
  function maybeUpdateRectForZooming(measure, rect) {
    if (!window.screen || screen.logicalXDPI == null ||
        screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
      return rect;
    var scaleX = screen.logicalXDPI / screen.deviceXDPI;
    var scaleY = screen.logicalYDPI / screen.deviceYDPI;
    return {left: rect.left * scaleX, right: rect.right * scaleX,
            top: rect.top * scaleY, bottom: rect.bottom * scaleY};
  }

  function clearLineMeasurementCacheFor(lineView) {
    if (lineView.measure) {
      lineView.measure.cache = {};
      lineView.measure.heights = null;
      if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
        lineView.measure.caches[i] = {};
    }
  }

  function clearLineMeasurementCache(cm) {
    cm.display.externalMeasure = null;
    removeChildren(cm.display.lineMeasure);
    for (var i = 0; i < cm.display.view.length; i++)
      clearLineMeasurementCacheFor(cm.display.view[i]);
  }

  function clearCaches(cm) {
    clearLineMeasurementCache(cm);
    cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
    if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
    cm.display.lineNumChars = null;
  }

  function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
  function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

  // Converts a {top, bottom, left, right} box from line-local
  // coordinates into another coordinate system. Context may be one of
  // "line", "div" (display.lineDiv), "local"/null (editor), "window",
  // or "page".
  function intoCoordSystem(cm, lineObj, rect, context) {
    if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
      var size = widgetHeight(lineObj.widgets[i]);
      rect.top += size; rect.bottom += size;
    }
    if (context == "line") return rect;
    if (!context) context = "local";
    var yOff = heightAtLine(lineObj);
    if (context == "local") yOff += paddingTop(cm.display);
    else yOff -= cm.display.viewOffset;
    if (context == "page" || context == "window") {
      var lOff = cm.display.lineSpace.getBoundingClientRect();
      yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
      var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
      rect.left += xOff; rect.right += xOff;
    }
    rect.top += yOff; rect.bottom += yOff;
    return rect;
  }

  // Coverts a box from "div" coords to another coordinate system.
  // Context may be "window", "page", "div", or "local"/null.
  function fromCoordSystem(cm, coords, context) {
    if (context == "div") return coords;
    var left = coords.left, top = coords.top;
    // First move into "page" coordinate system
    if (context == "page") {
      left -= pageScrollX();
      top -= pageScrollY();
    } else if (context == "local" || !context) {
      var localBox = cm.display.sizer.getBoundingClientRect();
      left += localBox.left;
      top += localBox.top;
    }

    var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
    return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
  }

  function charCoords(cm, pos, context, lineObj, bias) {
    if (!lineObj) lineObj = getLine(cm.doc, pos.line);
    return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
  }

  // Returns a box for a given cursor position, which may have an
  // 'other' property containing the position of the secondary cursor
  // on a bidi boundary.
  function cursorCoords(cm, pos, context, lineObj, preparedMeasure, varHeight) {
    lineObj = lineObj || getLine(cm.doc, pos.line);
    if (!preparedMeasure) preparedMeasure = prepareMeasureForLine(cm, lineObj);
    function get(ch, right) {
      var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
      if (right) m.left = m.right; else m.right = m.left;
      return intoCoordSystem(cm, lineObj, m, context);
    }
    function getBidi(ch, partPos) {
      var part = order[partPos], right = part.level % 2;
      if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
        part = order[--partPos];
        ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
        right = true;
      } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
        part = order[++partPos];
        ch = bidiLeft(part) - part.level % 2;
        right = false;
      }
      if (right && ch == part.to && ch > part.from) return get(ch - 1);
      return get(ch, right);
    }
    var order = getOrder(lineObj), ch = pos.ch;
    if (!order) return get(ch);
    var partPos = getBidiPartAt(order, ch);
    var val = getBidi(ch, partPos);
    if (bidiOther != null) val.other = getBidi(ch, bidiOther);
    return val;
  }

  // Used to cheaply estimate the coordinates for a position. Used for
  // intermediate scroll updates.
  function estimateCoords(cm, pos) {
    var left = 0, pos = clipPos(cm.doc, pos);
    if (!cm.options.lineWrapping) left = charWidth(cm.display) * pos.ch;
    var lineObj = getLine(cm.doc, pos.line);
    var top = heightAtLine(lineObj) + paddingTop(cm.display);
    return {left: left, right: left, top: top, bottom: top + lineObj.height};
  }

  // Positions returned by coordsChar contain some extra information.
  // xRel is the relative x position of the input coordinates compared
  // to the found position (so xRel > 0 means the coordinates are to
  // the right of the character position, for example). When outside
  // is true, that means the coordinates lie outside the line's
  // vertical range.
  function PosWithInfo(line, ch, outside, xRel) {
    var pos = Pos(line, ch);
    pos.xRel = xRel;
    if (outside) pos.outside = true;
    return pos;
  }

  // Compute the character position closest to the given coordinates.
  // Input must be lineSpace-local ("div" coordinate system).
  function coordsChar(cm, x, y) {
    var doc = cm.doc;
    y += cm.display.viewOffset;
    if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
    var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
    if (lineN > last)
      return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
    if (x < 0) x = 0;

    var lineObj = getLine(doc, lineN);
    for (;;) {
      var found = coordsCharInner(cm, lineObj, lineN, x, y);
      var merged = collapsedSpanAtEnd(lineObj);
      var mergedPos = merged && merged.find(0, true);
      if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
        lineN = lineNo(lineObj = mergedPos.to.line);
      else
        return found;
    }
  }

  function coordsCharInner(cm, lineObj, lineNo, x, y) {
    var innerOff = y - heightAtLine(lineObj);
    var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
    var preparedMeasure = prepareMeasureForLine(cm, lineObj);

    function getX(ch) {
      var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
      wrongLine = true;
      if (innerOff > sp.bottom) return sp.left - adjust;
      else if (innerOff < sp.top) return sp.left + adjust;
      else wrongLine = false;
      return sp.left;
    }

    var bidi = getOrder(lineObj), dist = lineObj.text.length;
    var from = lineLeft(lineObj), to = lineRight(lineObj);
    var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

    if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
    // Do a binary search between these bounds.
    for (;;) {
      if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
        var ch = x < fromX || x - fromX <= toX - x ? from : to;
        var xDiff = x - (ch == from ? fromX : toX);
        while (isExtendingChar(lineObj.text.charAt(ch))) ++ch;
        var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                              xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
        return pos;
      }
      var step = Math.ceil(dist / 2), middle = from + step;
      if (bidi) {
        middle = from;
        for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
      }
      var middleX = getX(middle);
      if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
      else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
    }
  }

  var measureText;
  // Compute the default text height.
  function textHeight(display) {
    if (display.cachedTextHeight != null) return display.cachedTextHeight;
    if (measureText == null) {
      measureText = elt("pre");
      // Measure a bunch of lines, for browsers that compute
      // fractional heights.
      for (var i = 0; i < 49; ++i) {
        measureText.appendChild(document.createTextNode("x"));
        measureText.appendChild(elt("br"));
      }
      measureText.appendChild(document.createTextNode("x"));
    }
    removeChildrenAndAdd(display.measure, measureText);
    var height = measureText.offsetHeight / 50;
    if (height > 3) display.cachedTextHeight = height;
    removeChildren(display.measure);
    return height || 1;
  }

  // Compute the default character width.
  function charWidth(display) {
    if (display.cachedCharWidth != null) return display.cachedCharWidth;
    var anchor = elt("span", "xxxxxxxxxx");
    var pre = elt("pre", [anchor]);
    removeChildrenAndAdd(display.measure, pre);
    var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
    if (width > 2) display.cachedCharWidth = width;
    return width || 10;
  }

  // OPERATIONS

  // Operations are used to wrap a series of changes to the editor
  // state in such a way that each change won't have to update the
  // cursor and display (which would be awkward, slow, and
  // error-prone). Instead, display updates are batched and then all
  // combined and executed at once.

  var operationGroup = null;

  var nextOpId = 0;
  // Start a new operation.
  function startOperation(cm) {
    cm.curOp = {
      cm: cm,
      viewChanged: false,      // Flag that indicates that lines might need to be redrawn
      startHeight: cm.doc.height, // Used to detect need to update scrollbar
      forceUpdate: false,      // Used to force a redraw
      updateInput: null,       // Whether to reset the input textarea
      typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
      changeObjs: null,        // Accumulated changes, for firing change events
      cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
      cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
      selectionChanged: false, // Whether the selection needs to be redrawn
      updateMaxLine: false,    // Set when the widest line needs to be determined anew
      scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
      scrollToPos: null,       // Used to scroll to a specific position
      id: ++nextOpId           // Unique ID
    };
    if (operationGroup) {
      operationGroup.ops.push(cm.curOp);
    } else {
      cm.curOp.ownsGroup = operationGroup = {
        ops: [cm.curOp],
        delayedCallbacks: []
      };
    }
  }

  function fireCallbacksForOps(group) {
    // Calls delayed callbacks and cursorActivity handlers until no
    // new ones appear
    var callbacks = group.delayedCallbacks, i = 0;
    do {
      for (; i < callbacks.length; i++)
        callbacks[i]();
      for (var j = 0; j < group.ops.length; j++) {
        var op = group.ops[j];
        if (op.cursorActivityHandlers)
          while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
            op.cursorActivityHandlers[op.cursorActivityCalled++](op.cm);
      }
    } while (i < callbacks.length);
  }

  // Finish an operation, updating the display and signalling delayed events
  function endOperation(cm) {
    var op = cm.curOp, group = op.ownsGroup;
    if (!group) return;

    try { fireCallbacksForOps(group); }
    finally {
      operationGroup = null;
      for (var i = 0; i < group.ops.length; i++)
        group.ops[i].cm.curOp = null;
      endOperations(group);
    }
  }

  // The DOM updates done when an operation finishes are batched so
  // that the minimum number of relayouts are required.
  function endOperations(group) {
    var ops = group.ops;
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_finish(ops[i]);
  }

  function endOperation_R1(op) {
    var cm = op.cm, display = cm.display;
    maybeClipScrollbars(cm);
    if (op.updateMaxLine) findMaxLine(cm);

    op.mustUpdate = op.viewChanged || op.forceUpdate || op.scrollTop != null ||
      op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                         op.scrollToPos.to.line >= display.viewTo) ||
      display.maxLineChanged && cm.options.lineWrapping;
    op.update = op.mustUpdate &&
      new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
  }

  function endOperation_W1(op) {
    op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
  }

  function endOperation_R2(op) {
    var cm = op.cm, display = cm.display;
    if (op.updatedDisplay) updateHeightsInViewport(cm);

    op.barMeasure = measureForScrollbars(cm);

    // If the max line changed since it was last measured, measure it,
    // and ensure the document's width matches it.
    // updateDisplay_W2 will use these properties to do the actual resizing
    if (display.maxLineChanged && !cm.options.lineWrapping) {
      op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
      cm.display.sizerWidth = op.adjustWidthTo;
      op.barMeasure.scrollWidth =
        Math.max(display.scroller.clientWidth, display.sizer.offsetLeft + op.adjustWidthTo + scrollGap(cm) + cm.display.barWidth);
      op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo - displayWidth(cm));
    }

    if (op.updatedDisplay || op.selectionChanged)
      op.newSelectionNodes = drawSelection(cm);
  }

  function endOperation_W2(op) {
    var cm = op.cm;

    if (op.adjustWidthTo != null) {
      cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
      if (op.maxScrollLeft < cm.doc.scrollLeft)
        setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true);
      cm.display.maxLineChanged = false;
    }

    if (op.newSelectionNodes)
      showSelection(cm, op.newSelectionNodes);
    if (op.updatedDisplay)
      setDocumentHeight(cm, op.barMeasure);
    if (op.updatedDisplay || op.startHeight != cm.doc.height)
      updateScrollbars(cm, op.barMeasure);

    if (op.selectionChanged) restartBlink(cm);

    if (cm.state.focused && op.updateInput)
      resetInput(cm, op.typing);
  }

  function endOperation_finish(op) {
    var cm = op.cm, display = cm.display, doc = cm.doc;

    if (op.updatedDisplay) postUpdateDisplay(cm, op.update);

    // Abort mouse wheel delta measurement, when scrolling explicitly
    if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
      display.wheelStartX = display.wheelStartY = null;

    // Propagate the scroll position to the actual DOM scroller
    if (op.scrollTop != null && (display.scroller.scrollTop != op.scrollTop || op.forceScroll)) {
      doc.scrollTop = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
      display.scrollbars.setScrollTop(doc.scrollTop);
      display.scroller.scrollTop = doc.scrollTop;
    }
    if (op.scrollLeft != null && (display.scroller.scrollLeft != op.scrollLeft || op.forceScroll)) {
      doc.scrollLeft = Math.max(0, Math.min(display.scroller.scrollWidth - displayWidth(cm), op.scrollLeft));
      display.scrollbars.setScrollLeft(doc.scrollLeft);
      display.scroller.scrollLeft = doc.scrollLeft;
      alignHorizontally(cm);
    }
    // If we need to scroll a specific position into view, do so.
    if (op.scrollToPos) {
      var coords = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                                     clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
      if (op.scrollToPos.isCursor && cm.state.focused) maybeScrollWindow(cm, coords);
    }

    // Fire events for markers that are hidden/unidden by editing or
    // undoing
    var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
    if (hidden) for (var i = 0; i < hidden.length; ++i)
      if (!hidden[i].lines.length) signal(hidden[i], "hide");
    if (unhidden) for (var i = 0; i < unhidden.length; ++i)
      if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

    if (display.wrapper.offsetHeight)
      doc.scrollTop = cm.display.scroller.scrollTop;

    // Fire change events, and delayed event handlers
    if (op.changeObjs)
      signal(cm, "changes", cm, op.changeObjs);
  }

  // Run the given function in an operation
  function runInOp(cm, f) {
    if (cm.curOp) return f();
    startOperation(cm);
    try { return f(); }
    finally { endOperation(cm); }
  }
  // Wraps a function in an operation. Returns the wrapped function.
  function operation(cm, f) {
    return function() {
      if (cm.curOp) return f.apply(cm, arguments);
      startOperation(cm);
      try { return f.apply(cm, arguments); }
      finally { endOperation(cm); }
    };
  }
  // Used to add methods to editor and doc instances, wrapping them in
  // operations.
  function methodOp(f) {
    return function() {
      if (this.curOp) return f.apply(this, arguments);
      startOperation(this);
      try { return f.apply(this, arguments); }
      finally { endOperation(this); }
    };
  }
  function docMethodOp(f) {
    return function() {
      var cm = this.cm;
      if (!cm || cm.curOp) return f.apply(this, arguments);
      startOperation(cm);
      try { return f.apply(this, arguments); }
      finally { endOperation(cm); }
    };
  }

  // VIEW TRACKING

  // These objects are used to represent the visible (currently drawn)
  // part of the document. A LineView may correspond to multiple
  // logical lines, if those are connected by collapsed ranges.
  function LineView(doc, line, lineN) {
    // The starting line
    this.line = line;
    // Continuing lines, if any
    this.rest = visualLineContinued(line);
    // Number of logical lines in this visual line
    this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
    this.node = this.text = null;
    this.hidden = lineIsHidden(doc, line);
  }

  // Create a range of LineView objects for the given lines.
  function buildViewArray(cm, from, to) {
    var array = [], nextPos;
    for (var pos = from; pos < to; pos = nextPos) {
      var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
      nextPos = pos + view.size;
      array.push(view);
    }
    return array;
  }

  // Updates the display.view data structure for a given change to the
  // document. From and to are in pre-change coordinates. Lendiff is
  // the amount of lines added or subtracted by the change. This is
  // used for changes that span multiple lines, or change the way
  // lines are divided into visual lines. regLineChange (below)
  // registers single-line changes.
  function regChange(cm, from, to, lendiff) {
    if (from == null) from = cm.doc.first;
    if (to == null) to = cm.doc.first + cm.doc.size;
    if (!lendiff) lendiff = 0;

    var display = cm.display;
    if (lendiff && to < display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers > from))
      display.updateLineNumbers = from;

    cm.curOp.viewChanged = true;

    if (from >= display.viewTo) { // Change after
      if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
        resetView(cm);
    } else if (to <= display.viewFrom) { // Change before
      if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
        resetView(cm);
      } else {
        display.viewFrom += lendiff;
        display.viewTo += lendiff;
      }
    } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
      resetView(cm);
    } else if (from <= display.viewFrom) { // Top overlap
      var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cut) {
        display.view = display.view.slice(cut.index);
        display.viewFrom = cut.lineN;
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    } else if (to >= display.viewTo) { // Bottom overlap
      var cut = viewCuttingPoint(cm, from, from, -1);
      if (cut) {
        display.view = display.view.slice(0, cut.index);
        display.viewTo = cut.lineN;
      } else {
        resetView(cm);
      }
    } else { // Gap in the middle
      var cutTop = viewCuttingPoint(cm, from, from, -1);
      var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cutTop && cutBot) {
        display.view = display.view.slice(0, cutTop.index)
          .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
          .concat(display.view.slice(cutBot.index));
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    }

    var ext = display.externalMeasured;
    if (ext) {
      if (to < ext.lineN)
        ext.lineN += lendiff;
      else if (from < ext.lineN + ext.size)
        display.externalMeasured = null;
    }
  }

  // Register a change to a single line. Type must be one of "text",
  // "gutter", "class", "widget"
  function regLineChange(cm, line, type) {
    cm.curOp.viewChanged = true;
    var display = cm.display, ext = cm.display.externalMeasured;
    if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
      display.externalMeasured = null;

    if (line < display.viewFrom || line >= display.viewTo) return;
    var lineView = display.view[findViewIndex(cm, line)];
    if (lineView.node == null) return;
    var arr = lineView.changes || (lineView.changes = []);
    if (indexOf(arr, type) == -1) arr.push(type);
  }

  // Clear the view.
  function resetView(cm) {
    cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
    cm.display.view = [];
    cm.display.viewOffset = 0;
  }

  // Find the view element corresponding to a given line. Return null
  // when the line isn't visible.
  function findViewIndex(cm, n) {
    if (n >= cm.display.viewTo) return null;
    n -= cm.display.viewFrom;
    if (n < 0) return null;
    var view = cm.display.view;
    for (var i = 0; i < view.length; i++) {
      n -= view[i].size;
      if (n < 0) return i;
    }
  }

  function viewCuttingPoint(cm, oldN, newN, dir) {
    var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
    if (!sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
      return {index: index, lineN: newN};
    for (var i = 0, n = cm.display.viewFrom; i < index; i++)
      n += view[i].size;
    if (n != oldN) {
      if (dir > 0) {
        if (index == view.length - 1) return null;
        diff = (n + view[index].size) - oldN;
        index++;
      } else {
        diff = n - oldN;
      }
      oldN += diff; newN += diff;
    }
    while (visualLineNo(cm.doc, newN) != newN) {
      if (index == (dir < 0 ? 0 : view.length - 1)) return null;
      newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
      index += dir;
    }
    return {index: index, lineN: newN};
  }

  // Force the view to cover a given range, adding empty view element
  // or clipping off existing ones as needed.
  function adjustView(cm, from, to) {
    var display = cm.display, view = display.view;
    if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
      display.view = buildViewArray(cm, from, to);
      display.viewFrom = from;
    } else {
      if (display.viewFrom > from)
        display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
      else if (display.viewFrom < from)
        display.view = display.view.slice(findViewIndex(cm, from));
      display.viewFrom = from;
      if (display.viewTo < to)
        display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
      else if (display.viewTo > to)
        display.view = display.view.slice(0, findViewIndex(cm, to));
    }
    display.viewTo = to;
  }

  // Count the number of lines in the view whose DOM representation is
  // out of date (or nonexistent).
  function countDirtyView(cm) {
    var view = cm.display.view, dirty = 0;
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (!lineView.hidden && (!lineView.node || lineView.changes)) ++dirty;
    }
    return dirty;
  }

  // INPUT HANDLING

  // Poll for input changes, using the normal rate of polling. This
  // runs as long as the editor is focused.
  function slowPoll(cm) {
    if (cm.display.pollingFast) return;
    cm.display.poll.set(cm.options.pollInterval, function() {
      readInput(cm);
      if (cm.state.focused) slowPoll(cm);
    });
  }

  // When an event has just come in that is likely to add or change
  // something in the input textarea, we poll faster, to ensure that
  // the change appears on the screen quickly.
  function fastPoll(cm) {
    var missed = false;
    cm.display.pollingFast = true;
    function p() {
      var changed = readInput(cm);
      if (!changed && !missed) {missed = true; cm.display.poll.set(60, p);}
      else {cm.display.pollingFast = false; slowPoll(cm);}
    }
    cm.display.poll.set(20, p);
  }

  // This will be set to an array of strings when copying, so that,
  // when pasting, we know what kind of selections the copied text
  // was made out of.
  var lastCopied = null;

  // Read input from the textarea, and update the document to match.
  // When something is selected, it is present in the textarea, and
  // selected (unless it is huge, in which case a placeholder is
  // used). When nothing is selected, the cursor sits after previously
  // seen text (can be empty), which is stored in prevInput (we must
  // not reset the textarea when typing, because that breaks IME).
  function readInput(cm) {
    var input = cm.display.input, prevInput = cm.display.prevInput, doc = cm.doc;
    // Since this is called a *lot*, try to bail out as cheaply as
    // possible when it is clear that nothing happened. hasSelection
    // will be the case when there is a lot of text in the textarea,
    // in which case reading its value would be expensive.
    if (!cm.state.focused || (hasSelection(input) && !prevInput) || isReadOnly(cm) || cm.options.disableInput || cm.state.keySeq)
      return false;
    // See paste handler for more on the fakedLastChar kludge
    if (cm.state.pasteIncoming && cm.state.fakedLastChar) {
      input.value = input.value.substring(0, input.value.length - 1);
      cm.state.fakedLastChar = false;
    }
    var text = input.value;
    // If nothing changed, bail.
    if (text == prevInput && !cm.somethingSelected()) return false;
    // Work around nonsensical selection resetting in IE9/10, and
    // inexplicable appearance of private area unicode characters on
    // some key combos in Mac (#2689).
    if (ie && ie_version >= 9 && cm.display.inputHasSelection === text ||
        mac && /[\uf700-\uf7ff]/.test(text)) {
      resetInput(cm);
      return false;
    }

    var withOp = !cm.curOp;
    if (withOp) startOperation(cm);
    cm.display.shift = false;

    if (text.charCodeAt(0) == 0x200b && doc.sel == cm.display.selForContextMenu && !prevInput)
      prevInput = "\u200b";
    // Find the part of the input that is actually new
    var same = 0, l = Math.min(prevInput.length, text.length);
    while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;
    var inserted = text.slice(same), textLines = splitLines(inserted);

    // When pasing N lines into N selections, insert one line per selection
    var multiPaste = null;
    if (cm.state.pasteIncoming && doc.sel.ranges.length > 1) {
      if (lastCopied && lastCopied.join("\n") == inserted)
        multiPaste = doc.sel.ranges.length % lastCopied.length == 0 && map(lastCopied, splitLines);
      else if (textLines.length == doc.sel.ranges.length)
        multiPaste = map(textLines, function(l) { return [l]; });
    }

    // Normal behavior is to insert the new text into every selection
    for (var i = doc.sel.ranges.length - 1; i >= 0; i--) {
      var range = doc.sel.ranges[i];
      var from = range.from(), to = range.to();
      // Handle deletion
      if (same < prevInput.length)
        from = Pos(from.line, from.ch - (prevInput.length - same));
      // Handle overwrite
      else if (cm.state.overwrite && range.empty() && !cm.state.pasteIncoming)
        to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length));
      var updateInput = cm.curOp.updateInput;
      var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i % multiPaste.length] : textLines,
                         origin: cm.state.pasteIncoming ? "paste" : cm.state.cutIncoming ? "cut" : "+input"};
      makeChange(cm.doc, changeEvent);
      signalLater(cm, "inputRead", cm, changeEvent);
      // When an 'electric' character is inserted, immediately trigger a reindent
      if (inserted && !cm.state.pasteIncoming && cm.options.electricChars &&
          cm.options.smartIndent && range.head.ch < 100 &&
          (!i || doc.sel.ranges[i - 1].head.line != range.head.line)) {
        var mode = cm.getModeAt(range.head);
        var end = changeEnd(changeEvent);
        if (mode.electricChars) {
          for (var j = 0; j < mode.electricChars.length; j++)
            if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
              indentLine(cm, end.line, "smart");
              break;
            }
        } else if (mode.electricInput) {
          if (mode.electricInput.test(getLine(doc, end.line).text.slice(0, end.ch)))
            indentLine(cm, end.line, "smart");
        }
      }
    }
    ensureCursorVisible(cm);
    cm.curOp.updateInput = updateInput;
    cm.curOp.typing = true;

    // Don't leave long text in the textarea, since it makes further polling slow
    if (text.length > 1000 || text.indexOf("\n") > -1) input.value = cm.display.prevInput = "";
    else cm.display.prevInput = text;
    if (withOp) endOperation(cm);
    cm.state.pasteIncoming = cm.state.cutIncoming = false;
    return true;
  }

  // Reset the input to correspond to the selection (or to be empty,
  // when not typing and nothing is selected)
  function resetInput(cm, typing) {
    if (cm.display.contextMenuPending) return;
    var minimal, selected, doc = cm.doc;
    if (cm.somethingSelected()) {
      cm.display.prevInput = "";
      var range = doc.sel.primary();
      minimal = hasCopyEvent &&
        (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
      var content = minimal ? "-" : selected || cm.getSelection();
      cm.display.input.value = content;
      if (cm.state.focused) selectInput(cm.display.input);
      if (ie && ie_version >= 9) cm.display.inputHasSelection = content;
    } else if (!typing) {
      cm.display.prevInput = cm.display.input.value = "";
      if (ie && ie_version >= 9) cm.display.inputHasSelection = null;
    }
    cm.display.inaccurateSelection = minimal;
  }

  function focusInput(cm) {
    if (cm.options.readOnly != "nocursor" && (!mobile || activeElt() != cm.display.input))
      cm.display.input.focus();
  }

  function ensureFocus(cm) {
    if (!cm.state.focused) { focusInput(cm); onFocus(cm); }
  }

  function isReadOnly(cm) {
    return cm.options.readOnly || cm.doc.cantEdit;
  }

  // EVENT HANDLERS

  // Attach the necessary event handlers when initializing the editor
  function registerEventHandlers(cm) {
    var d = cm.display;
    on(d.scroller, "mousedown", operation(cm, onMouseDown));
    // Older IE's will not fire a second mousedown for a double click
    if (ie && ie_version < 11)
      on(d.scroller, "dblclick", operation(cm, function(e) {
        if (signalDOMEvent(cm, e)) return;
        var pos = posFromMouse(cm, e);
        if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
        e_preventDefault(e);
        var word = cm.findWordAt(pos);
        extendSelection(cm.doc, word.anchor, word.head);
      }));
    else
      on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
    // Prevent normal selection in the editor (we handle our own)
    on(d.lineSpace, "selectstart", function(e) {
      if (!eventInWidget(d, e)) e_preventDefault(e);
    });
    // Some browsers fire contextmenu *after* opening the menu, at
    // which point we can't mess with it anymore. Context menu is
    // handled in onMouseDown for these browsers.
    if (!captureRightClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

    // Sync scrolling between fake scrollbars and real scrollable
    // area, ensure viewport is updated when scrolling.
    on(d.scroller, "scroll", function() {
      if (d.scroller.clientHeight) {
        setScrollTop(cm, d.scroller.scrollTop);
        setScrollLeft(cm, d.scroller.scrollLeft, true);
        signal(cm, "scroll", cm);
      }
    });

    // Listen to wheel events in order to try and update the viewport on time.
    on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
    on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

    // Prevent wrapper from ever scrolling
    on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

    on(d.input, "keyup", function(e) { onKeyUp.call(cm, e); });
    on(d.input, "input", function() {
      if (ie && ie_version >= 9 && cm.display.inputHasSelection) cm.display.inputHasSelection = null;
      readInput(cm);
    });
    on(d.input, "keydown", operation(cm, onKeyDown));
    on(d.input, "keypress", operation(cm, onKeyPress));
    on(d.input, "focus", bind(onFocus, cm));
    on(d.input, "blur", bind(onBlur, cm));

    function drag_(e) {
      if (!signalDOMEvent(cm, e)) e_stop(e);
    }
    if (cm.options.dragDrop) {
      on(d.scroller, "dragstart", function(e){onDragStart(cm, e);});
      on(d.scroller, "dragenter", drag_);
      on(d.scroller, "dragover", drag_);
      on(d.scroller, "drop", operation(cm, onDrop));
    }
    on(d.scroller, "paste", function(e) {
      if (eventInWidget(d, e)) return;
      cm.state.pasteIncoming = true;
      focusInput(cm);
      fastPoll(cm);
    });
    on(d.input, "paste", function() {
      // Workaround for webkit bug https://bugs.webkit.org/show_bug.cgi?id=90206
      // Add a char to the end of textarea before paste occur so that
      // selection doesn't span to the end of textarea.
      if (webkit && !cm.state.fakedLastChar && !(new Date - cm.state.lastMiddleDown < 200)) {
        var start = d.input.selectionStart, end = d.input.selectionEnd;
        d.input.value += "$";
        // The selection end needs to be set before the start, otherwise there
        // can be an intermediate non-empty selection between the two, which
        // can override the middle-click paste buffer on linux and cause the
        // wrong thing to get pasted.
        d.input.selectionEnd = end;
        d.input.selectionStart = start;
        cm.state.fakedLastChar = true;
      }
      cm.state.pasteIncoming = true;
      fastPoll(cm);
    });

    function prepareCopyCut(e) {
      if (cm.somethingSelected()) {
        lastCopied = cm.getSelections();
        if (d.inaccurateSelection) {
          d.prevInput = "";
          d.inaccurateSelection = false;
          d.input.value = lastCopied.join("\n");
          selectInput(d.input);
        }
      } else {
        var text = [], ranges = [];
        for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
          var line = cm.doc.sel.ranges[i].head.line;
          var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
          ranges.push(lineRange);
          text.push(cm.getRange(lineRange.anchor, lineRange.head));
        }
        if (e.type == "cut") {
          cm.setSelections(ranges, null, sel_dontScroll);
        } else {
          d.prevInput = "";
          d.input.value = text.join("\n");
          selectInput(d.input);
        }
        lastCopied = text;
      }
      if (e.type == "cut") cm.state.cutIncoming = true;
    }
    on(d.input, "cut", prepareCopyCut);
    on(d.input, "copy", prepareCopyCut);

    // Needed to handle Tab key in KHTML
    if (khtml) on(d.sizer, "mouseup", function() {
      if (activeElt() == d.input) d.input.blur();
      focusInput(cm);
    });
  }

  // Called when the window resizes
  function onResize(cm) {
    var d = cm.display;
    if (d.lastWrapHeight == d.wrapper.clientHeight && d.lastWrapWidth == d.wrapper.clientWidth)
      return;
    // Might be a text scaling operation, clear size caches.
    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
    d.scrollbarsClipped = false;
    cm.setSize();
  }

  // MOUSE EVENTS

  // Return true when the given mouse event happened in a widget
  function eventInWidget(display, e) {
    for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
      if (!n || (n.nodeType == 1 && n.getAttribute("cm-ignore-events") == "true") ||
          (n.parentNode == display.sizer && n != display.mover))
        return true;
    }
  }

  // Given a mouse event, find the corresponding position. If liberal
  // is false, it checks whether a gutter or scrollbar was clicked,
  // and returns null if it was. forRect is used by rectangular
  // selections, and tries to estimate a character position even for
  // coordinates beyond the right of the text.
  function posFromMouse(cm, e, liberal, forRect) {
    var display = cm.display;
    if (!liberal && e_target(e).getAttribute("not-content") == "true") return null;

    var x, y, space = display.lineSpace.getBoundingClientRect();
    // Fails unpredictably on IE[67] when mouse is dragged around quickly.
    try { x = e.clientX - space.left; y = e.clientY - space.top; }
    catch (e) { return null; }
    var coords = coordsChar(cm, x, y), line;
    if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
      var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
      coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
    }
    return coords;
  }

  // A mouse down can be a single click, double click, triple click,
  // start of selection drag, start of text drag, new cursor
  // (ctrl-click), rectangle drag (alt-drag), or xwin
  // middle-click-paste. Or it might be a click on something we should
  // not interfere with, such as a scrollbar or widget.
  function onMouseDown(e) {
    if (signalDOMEvent(this, e)) return;
    var cm = this, display = cm.display;
    display.shift = e.shiftKey;

    if (eventInWidget(display, e)) {
      if (!webkit) {
        // Briefly turn off draggability, to allow widgets to do
        // normal dragging things.
        display.scroller.draggable = false;
        setTimeout(function(){display.scroller.draggable = true;}, 100);
      }
      return;
    }
    if (clickInGutter(cm, e)) return;
    var start = posFromMouse(cm, e);
    window.focus();

    switch (e_button(e)) {
    case 1:
      if (start)
        leftButtonDown(cm, e, start);
      else if (e_target(e) == display.scroller)
        e_preventDefault(e);
      break;
    case 2:
      if (webkit) cm.state.lastMiddleDown = +new Date;
      if (start) extendSelection(cm.doc, start);
      setTimeout(bind(focusInput, cm), 20);
      e_preventDefault(e);
      break;
    case 3:
      if (captureRightClick) onContextMenu(cm, e);
      break;
    }
  }

  var lastClick, lastDoubleClick;
  function leftButtonDown(cm, e, start) {
    setTimeout(bind(ensureFocus, cm), 0);

    var now = +new Date, type;
    if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
      type = "triple";
    } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
      type = "double";
      lastDoubleClick = {time: now, pos: start};
    } else {
      type = "single";
      lastClick = {time: now, pos: start};
    }

    var sel = cm.doc.sel, modifier = mac ? e.metaKey : e.ctrlKey, contained;
    if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) &&
        type == "single" && (contained = sel.contains(start)) > -1 &&
        !sel.ranges[contained].empty())
      leftButtonStartDrag(cm, e, start, modifier);
    else
      leftButtonSelect(cm, e, start, type, modifier);
  }

  // Start a text drag. When it ends, see if any dragging actually
  // happen, and treat as a click if it didn't.
  function leftButtonStartDrag(cm, e, start, modifier) {
    var display = cm.display;
    var dragEnd = operation(cm, function(e2) {
      if (webkit) display.scroller.draggable = false;
      cm.state.draggingText = false;
      off(document, "mouseup", dragEnd);
      off(display.scroller, "drop", dragEnd);
      if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
        e_preventDefault(e2);
        if (!modifier)
          extendSelection(cm.doc, start);
        focusInput(cm);
        // Work around unexplainable focus problem in IE9 (#2127)
        if (ie && ie_version == 9)
          setTimeout(function() {document.body.focus(); focusInput(cm);}, 20);
      }
    });
    // Let the drag handler handle this.
    if (webkit) display.scroller.draggable = true;
    cm.state.draggingText = dragEnd;
    // IE's approach to draggable
    if (display.scroller.dragDrop) display.scroller.dragDrop();
    on(document, "mouseup", dragEnd);
    on(display.scroller, "drop", dragEnd);
  }

  // Normal selection, as opposed to text dragging.
  function leftButtonSelect(cm, e, start, type, addNew) {
    var display = cm.display, doc = cm.doc;
    e_preventDefault(e);

    var ourRange, ourIndex, startSel = doc.sel, ranges = startSel.ranges;
    if (addNew && !e.shiftKey) {
      ourIndex = doc.sel.contains(start);
      if (ourIndex > -1)
        ourRange = ranges[ourIndex];
      else
        ourRange = new Range(start, start);
    } else {
      ourRange = doc.sel.primary();
    }

    if (e.altKey) {
      type = "rect";
      if (!addNew) ourRange = new Range(start, start);
      start = posFromMouse(cm, e, true, true);
      ourIndex = -1;
    } else if (type == "double") {
      var word = cm.findWordAt(start);
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, word.anchor, word.head);
      else
        ourRange = word;
    } else if (type == "triple") {
      var line = new Range(Pos(start.line, 0), clipPos(doc, Pos(start.line + 1, 0)));
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, line.anchor, line.head);
      else
        ourRange = line;
    } else {
      ourRange = extendRange(doc, ourRange, start);
    }

    if (!addNew) {
      ourIndex = 0;
      setSelection(doc, new Selection([ourRange], 0), sel_mouse);
      startSel = doc.sel;
    } else if (ourIndex == -1) {
      ourIndex = ranges.length;
      setSelection(doc, normalizeSelection(ranges.concat([ourRange]), ourIndex),
                   {scroll: false, origin: "*mouse"});
    } else if (ranges.length > 1 && ranges[ourIndex].empty() && type == "single") {
      setSelection(doc, normalizeSelection(ranges.slice(0, ourIndex).concat(ranges.slice(ourIndex + 1)), 0));
      startSel = doc.sel;
    } else {
      replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
    }

    var lastPos = start;
    function extendTo(pos) {
      if (cmp(lastPos, pos) == 0) return;
      lastPos = pos;

      if (type == "rect") {
        var ranges = [], tabSize = cm.options.tabSize;
        var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
        var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
        var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
        for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
             line <= end; line++) {
          var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
          if (left == right)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
          else if (text.length > leftPos)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
        }
        if (!ranges.length) ranges.push(new Range(start, start));
        setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                     {origin: "*mouse", scroll: false});
        cm.scrollIntoView(pos);
      } else {
        var oldRange = ourRange;
        var anchor = oldRange.anchor, head = pos;
        if (type != "single") {
          if (type == "double")
            var range = cm.findWordAt(pos);
          else
            var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
          if (cmp(range.anchor, anchor) > 0) {
            head = range.head;
            anchor = minPos(oldRange.from(), range.anchor);
          } else {
            head = range.anchor;
            anchor = maxPos(oldRange.to(), range.head);
          }
        }
        var ranges = startSel.ranges.slice(0);
        ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
        setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
      }
    }

    var editorSize = display.wrapper.getBoundingClientRect();
    // Used to ensure timeout re-tries don't fire when another extend
    // happened in the meantime (clearTimeout isn't reliable -- at
    // least on Chrome, the timeouts still happen even when cleared,
    // if the clear happens after their scheduled firing time).
    var counter = 0;

    function extend(e) {
      var curCount = ++counter;
      var cur = posFromMouse(cm, e, true, type == "rect");
      if (!cur) return;
      if (cmp(cur, lastPos) != 0) {
        ensureFocus(cm);
        extendTo(cur);
        var visible = visibleLines(display, doc);
        if (cur.line >= visible.to || cur.line < visible.from)
          setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
      } else {
        var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
        if (outside) setTimeout(operation(cm, function() {
          if (counter != curCount) return;
          display.scroller.scrollTop += outside;
          extend(e);
        }), 50);
      }
    }

    function done(e) {
      counter = Infinity;
      e_preventDefault(e);
      focusInput(cm);
      off(document, "mousemove", move);
      off(document, "mouseup", up);
      doc.history.lastSelOrigin = null;
    }

    var move = operation(cm, function(e) {
      if (!e_button(e)) done(e);
      else extend(e);
    });
    var up = operation(cm, done);
    on(document, "mousemove", move);
    on(document, "mouseup", up);
  }

  // Determines whether an event happened in the gutter, and fires the
  // handlers for the corresponding event.
  function gutterEvent(cm, e, type, prevent, signalfn) {
    try { var mX = e.clientX, mY = e.clientY; }
    catch(e) { return false; }
    if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) return false;
    if (prevent) e_preventDefault(e);

    var display = cm.display;
    var lineBox = display.lineDiv.getBoundingClientRect();

    if (mY > lineBox.bottom || !hasHandler(cm, type)) return e_defaultPrevented(e);
    mY -= lineBox.top - display.viewOffset;

    for (var i = 0; i < cm.options.gutters.length; ++i) {
      var g = display.gutters.childNodes[i];
      if (g && g.getBoundingClientRect().right >= mX) {
        var line = lineAtHeight(cm.doc, mY);
        var gutter = cm.options.gutters[i];
        signalfn(cm, type, cm, line, gutter, e);
        return e_defaultPrevented(e);
      }
    }
  }

  function clickInGutter(cm, e) {
    return gutterEvent(cm, e, "gutterClick", true, signalLater);
  }

  // Kludge to work around strange IE behavior where it'll sometimes
  // re-fire a series of drag-related events right after the drop (#1551)
  var lastDrop = 0;

  function onDrop(e) {
    var cm = this;
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
      return;
    e_preventDefault(e);
    if (ie) lastDrop = +new Date;
    var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
    if (!pos || isReadOnly(cm)) return;
    // Might be a file drop, in which case we simply extract the text
    // and insert it.
    if (files && files.length && window.FileReader && window.File) {
      var n = files.length, text = Array(n), read = 0;
      var loadFile = function(file, i) {
        var reader = new FileReader;
        reader.onload = operation(cm, function() {
          text[i] = reader.result;
          if (++read == n) {
            pos = clipPos(cm.doc, pos);
            var change = {from: pos, to: pos, text: splitLines(text.join("\n")), origin: "paste"};
            makeChange(cm.doc, change);
            setSelectionReplaceHistory(cm.doc, simpleSelection(pos, changeEnd(change)));
          }
        });
        reader.readAsText(file);
      };
      for (var i = 0; i < n; ++i) loadFile(files[i], i);
    } else { // Normal drop
      // Don't do a replace if the drop happened inside of the selected text.
      if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
        cm.state.draggingText(e);
        // Ensure the editor is re-focused
        setTimeout(bind(focusInput, cm), 20);
        return;
      }
      try {
        var text = e.dataTransfer.getData("Text");
        if (text) {
          if (cm.state.draggingText && !(mac ? e.metaKey : e.ctrlKey))
            var selected = cm.listSelections();
          setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
          if (selected) for (var i = 0; i < selected.length; ++i)
            replaceRange(cm.doc, "", selected[i].anchor, selected[i].head, "drag");
          cm.replaceSelection(text, "around", "paste");
          focusInput(cm);
        }
      }
      catch(e){}
    }
  }

  function onDragStart(cm, e) {
    if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return; }
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) return;

    e.dataTransfer.setData("Text", cm.getSelection());

    // Use dummy image instead of default browsers image.
    // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
    if (e.dataTransfer.setDragImage && !safari) {
      var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
      img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      if (presto) {
        img.width = img.height = 1;
        cm.display.wrapper.appendChild(img);
        // Force a relayout, or Opera won't use our image for some obscure reason
        img._top = img.offsetTop;
      }
      e.dataTransfer.setDragImage(img, 0, 0);
      if (presto) img.parentNode.removeChild(img);
    }
  }

  // SCROLL EVENTS

  // Sync the scrollable area and scrollbars, ensure the viewport
  // covers the visible area.
  function setScrollTop(cm, val) {
    if (Math.abs(cm.doc.scrollTop - val) < 2) return;
    cm.doc.scrollTop = val;
    if (!gecko) updateDisplaySimple(cm, {top: val});
    if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
    cm.display.scrollbars.setScrollTop(val);
    if (gecko) updateDisplaySimple(cm);
    startWorker(cm, 100);
  }
  // Sync scroller and scrollbar, ensure the gutter elements are
  // aligned.
  function setScrollLeft(cm, val, isScroller) {
    if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
    val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
    cm.doc.scrollLeft = val;
    alignHorizontally(cm);
    if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
    cm.display.scrollbars.setScrollLeft(val);
  }

  // Since the delta values reported on mouse wheel events are
  // unstandardized between browsers and even browser versions, and
  // generally horribly unpredictable, this code starts by measuring
  // the scroll effect that the first few mouse wheel events have,
  // and, from that, detects the way it can convert deltas to pixel
  // offsets afterwards.
  //
  // The reason we want to know the amount a wheel event will scroll
  // is that it gives us a chance to update the display before the
  // actual scrolling happens, reducing flickering.

  var wheelSamples = 0, wheelPixelsPerUnit = null;
  // Fill in a browser-detected starting value on browsers where we
  // know one. These don't have to be accurate -- the result of them
  // being wrong would just be a slight flicker on the first wheel
  // scroll (if it is large enough).
  if (ie) wheelPixelsPerUnit = -.53;
  else if (gecko) wheelPixelsPerUnit = 15;
  else if (chrome) wheelPixelsPerUnit = -.7;
  else if (safari) wheelPixelsPerUnit = -1/3;

  var wheelEventDelta = function(e) {
    var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
    if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
    if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
    else if (dy == null) dy = e.wheelDelta;
    return {x: dx, y: dy};
  };
  CodeMirror.wheelEventPixels = function(e) {
    var delta = wheelEventDelta(e);
    delta.x *= wheelPixelsPerUnit;
    delta.y *= wheelPixelsPerUnit;
    return delta;
  };

  function onScrollWheel(cm, e) {
    var delta = wheelEventDelta(e), dx = delta.x, dy = delta.y;

    var display = cm.display, scroll = display.scroller;
    // Quit if there's nothing to scroll here
    if (!(dx && scroll.scrollWidth > scroll.clientWidth ||
          dy && scroll.scrollHeight > scroll.clientHeight)) return;

    // Webkit browsers on OS X abort momentum scrolls when the target
    // of the scroll event is removed from the scrollable element.
    // This hack (see related code in patchDisplay) makes sure the
    // element is kept around.
    if (dy && mac && webkit) {
      outer: for (var cur = e.target, view = display.view; cur != scroll; cur = cur.parentNode) {
        for (var i = 0; i < view.length; i++) {
          if (view[i].node == cur) {
            cm.display.currentWheelTarget = cur;
            break outer;
          }
        }
      }
    }

    // On some browsers, horizontal scrolling will cause redraws to
    // happen before the gutter has been realigned, causing it to
    // wriggle around in a most unseemly way. When we have an
    // estimated pixels/delta value, we just handle horizontal
    // scrolling entirely here. It'll be slightly off from native, but
    // better than glitching out.
    if (dx && !gecko && !presto && wheelPixelsPerUnit != null) {
      if (dy)
        setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
      setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
      e_preventDefault(e);
      display.wheelStartX = null; // Abort measurement, if in progress
      return;
    }

    // 'Project' the visible viewport to cover the area that is being
    // scrolled into view (if we know enough to estimate it).
    if (dy && wheelPixelsPerUnit != null) {
      var pixels = dy * wheelPixelsPerUnit;
      var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
      if (pixels < 0) top = Math.max(0, top + pixels - 50);
      else bot = Math.min(cm.doc.height, bot + pixels + 50);
      updateDisplaySimple(cm, {top: top, bottom: bot});
    }

    if (wheelSamples < 20) {
      if (display.wheelStartX == null) {
        display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
        display.wheelDX = dx; display.wheelDY = dy;
        setTimeout(function() {
          if (display.wheelStartX == null) return;
          var movedX = scroll.scrollLeft - display.wheelStartX;
          var movedY = scroll.scrollTop - display.wheelStartY;
          var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
            (movedX && display.wheelDX && movedX / display.wheelDX);
          display.wheelStartX = display.wheelStartY = null;
          if (!sample) return;
          wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
          ++wheelSamples;
        }, 200);
      } else {
        display.wheelDX += dx; display.wheelDY += dy;
      }
    }
  }

  // KEY EVENTS

  // Run a handler that was bound to a key.
  function doHandleBinding(cm, bound, dropShift) {
    if (typeof bound == "string") {
      bound = commands[bound];
      if (!bound) return false;
    }
    // Ensure previous input has been read, so that the handler sees a
    // consistent view of the document
    if (cm.display.pollingFast && readInput(cm)) cm.display.pollingFast = false;
    var prevShift = cm.display.shift, done = false;
    try {
      if (isReadOnly(cm)) cm.state.suppressEdits = true;
      if (dropShift) cm.display.shift = false;
      done = bound(cm) != Pass;
    } finally {
      cm.display.shift = prevShift;
      cm.state.suppressEdits = false;
    }
    return done;
  }

  function lookupKeyForEditor(cm, name, handle) {
    for (var i = 0; i < cm.state.keyMaps.length; i++) {
      var result = lookupKey(name, cm.state.keyMaps[i], handle, cm);
      if (result) return result;
    }
    return (cm.options.extraKeys && lookupKey(name, cm.options.extraKeys, handle, cm))
      || lookupKey(name, cm.options.keyMap, handle, cm);
  }

  var stopSeq = new Delayed;
  function dispatchKey(cm, name, e, handle) {
    var seq = cm.state.keySeq;
    if (seq) {
      if (isModifierKey(name)) return "handled";
      stopSeq.set(50, function() {
        if (cm.state.keySeq == seq) {
          cm.state.keySeq = null;
          resetInput(cm);
        }
      });
      name = seq + " " + name;
    }
    var result = lookupKeyForEditor(cm, name, handle);

    if (result == "multi")
      cm.state.keySeq = name;
    if (result == "handled")
      signalLater(cm, "keyHandled", cm, name, e);

    if (result == "handled" || result == "multi") {
      e_preventDefault(e);
      restartBlink(cm);
    }

    if (seq && !result && /\'$/.test(name)) {
      e_preventDefault(e);
      return true;
    }
    return !!result;
  }

  // Handle a key from the keydown event.
  function handleKeyBinding(cm, e) {
    var name = keyName(e, true);
    if (!name) return false;

    if (e.shiftKey && !cm.state.keySeq) {
      // First try to resolve full name (including 'Shift-'). Failing
      // that, see if there is a cursor-motion command (starting with
      // 'go') bound to the keyname without 'Shift-'.
      return dispatchKey(cm, "Shift-" + name, e, function(b) {return doHandleBinding(cm, b, true);})
          || dispatchKey(cm, name, e, function(b) {
               if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                 return doHandleBinding(cm, b);
             });
    } else {
      return dispatchKey(cm, name, e, function(b) { return doHandleBinding(cm, b); });
    }
  }

  // Handle a key from the keypress event
  function handleCharBinding(cm, e, ch) {
    return dispatchKey(cm, "'" + ch + "'", e,
                       function(b) { return doHandleBinding(cm, b, true); });
  }

  var lastStoppedKey = null;
  function onKeyDown(e) {
    var cm = this;
    ensureFocus(cm);
    if (signalDOMEvent(cm, e)) return;
    // IE does strange things with escape.
    if (ie && ie_version < 11 && e.keyCode == 27) e.returnValue = false;
    var code = e.keyCode;
    cm.display.shift = code == 16 || e.shiftKey;
    var handled = handleKeyBinding(cm, e);
    if (presto) {
      lastStoppedKey = handled ? code : null;
      // Opera has no cut event... we try to at least catch the key combo
      if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
        cm.replaceSelection("", null, "cut");
    }

    // Turn mouse into crosshair when Alt is held on Mac.
    if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
      showCrossHair(cm);
  }

  function showCrossHair(cm) {
    var lineDiv = cm.display.lineDiv;
    addClass(lineDiv, "CodeMirror-crosshair");

    function up(e) {
      if (e.keyCode == 18 || !e.altKey) {
        rmClass(lineDiv, "CodeMirror-crosshair");
        off(document, "keyup", up);
        off(document, "mouseover", up);
      }
    }
    on(document, "keyup", up);
    on(document, "mouseover", up);
  }

  function onKeyUp(e) {
    if (e.keyCode == 16) this.doc.sel.shift = false;
    signalDOMEvent(this, e);
  }

  function onKeyPress(e) {
    var cm = this;
    if (signalDOMEvent(cm, e) || e.ctrlKey && !e.altKey || mac && e.metaKey) return;
    var keyCode = e.keyCode, charCode = e.charCode;
    if (presto && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
    if (((presto && (!e.which || e.which < 10)) || khtml) && handleKeyBinding(cm, e)) return;
    var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
    if (handleCharBinding(cm, e, ch)) return;
    if (ie && ie_version >= 9) cm.display.inputHasSelection = null;
    fastPoll(cm);
  }

  // FOCUS/BLUR EVENTS

  function onFocus(cm) {
    if (cm.options.readOnly == "nocursor") return;
    if (!cm.state.focused) {
      signal(cm, "focus", cm);
      cm.state.focused = true;
      addClass(cm.display.wrapper, "CodeMirror-focused");
      // The prevInput test prevents this from firing when a context
      // menu is closed (since the resetInput would kill the
      // select-all detection hack)
      if (!cm.curOp && cm.display.selForContextMenu != cm.doc.sel) {
        resetInput(cm);
        if (webkit) setTimeout(bind(resetInput, cm, true), 0); // Issue #1730
      }
    }
    slowPoll(cm);
    restartBlink(cm);
  }
  function onBlur(cm) {
    if (cm.state.focused) {
      signal(cm, "blur", cm);
      cm.state.focused = false;
      rmClass(cm.display.wrapper, "CodeMirror-focused");
    }
    clearInterval(cm.display.blinker);
    setTimeout(function() {if (!cm.state.focused) cm.display.shift = false;}, 150);
  }

  // CONTEXT MENU HANDLING

  // To make the context menu work, we need to briefly unhide the
  // textarea (making it as unobtrusive as possible) to let the
  // right-click take effect on it.
  function onContextMenu(cm, e) {
    if (signalDOMEvent(cm, e, "contextmenu")) return;
    var display = cm.display;
    if (eventInWidget(display, e) || contextMenuInGutter(cm, e)) return;

    var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
    if (!pos || presto) return; // Opera is difficult.

    // Reset the current text selection only if the click is done outside of the selection
    // and 'resetSelectionOnContextMenu' option is true.
    var reset = cm.options.resetSelectionOnContextMenu;
    if (reset && cm.doc.sel.contains(pos) == -1)
      operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll);

    var oldCSS = display.input.style.cssText;
    display.inputDiv.style.position = "absolute";
    display.input.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
      "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: " +
      (ie ? "rgba(255, 255, 255, .05)" : "transparent") +
      "; outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
    if (webkit) var oldScrollY = window.scrollY; // Work around Chrome issue (#2712)
    focusInput(cm);
    if (webkit) window.scrollTo(null, oldScrollY);
    resetInput(cm);
    // Adds "Select all" to context menu in FF
    if (!cm.somethingSelected()) display.input.value = display.prevInput = " ";
    display.contextMenuPending = true;
    display.selForContextMenu = cm.doc.sel;
    clearTimeout(display.detectingSelectAll);

    // Select-all will be greyed out if there's nothing to select, so
    // this adds a zero-width space so that we can later check whether
    // it got selected.
    function prepareSelectAllHack() {
      if (display.input.selectionStart != null) {
        var selected = cm.somethingSelected();
        var extval = display.input.value = "\u200b" + (selected ? display.input.value : "");
        display.prevInput = selected ? "" : "\u200b";
        display.input.selectionStart = 1; display.input.selectionEnd = extval.length;
        // Re-set this, in case some other handler touched the
        // selection in the meantime.
        display.selForContextMenu = cm.doc.sel;
      }
    }
    function rehide() {
      display.contextMenuPending = false;
      display.inputDiv.style.position = "relative";
      display.input.style.cssText = oldCSS;
      if (ie && ie_version < 9) display.scrollbars.setScrollTop(display.scroller.scrollTop = scrollPos);
      slowPoll(cm);

      // Try to detect the user choosing select-all
      if (display.input.selectionStart != null) {
        if (!ie || (ie && ie_version < 9)) prepareSelectAllHack();
        var i = 0, poll = function() {
          if (display.selForContextMenu == cm.doc.sel && display.input.selectionStart == 0)
            operation(cm, commands.selectAll)(cm);
          else if (i++ < 10) display.detectingSelectAll = setTimeout(poll, 500);
          else resetInput(cm);
        };
        display.detectingSelectAll = setTimeout(poll, 200);
      }
    }

    if (ie && ie_version >= 9) prepareSelectAllHack();
    if (captureRightClick) {
      e_stop(e);
      var mouseup = function() {
        off(window, "mouseup", mouseup);
        setTimeout(rehide, 20);
      };
      on(window, "mouseup", mouseup);
    } else {
      setTimeout(rehide, 50);
    }
  }

  function contextMenuInGutter(cm, e) {
    if (!hasHandler(cm, "gutterContextMenu")) return false;
    return gutterEvent(cm, e, "gutterContextMenu", false, signal);
  }

  // UPDATING

  // Compute the position of the end of a change (its 'to' property
  // refers to the pre-change end).
  var changeEnd = CodeMirror.changeEnd = function(change) {
    if (!change.text) return change.to;
    return Pos(change.from.line + change.text.length - 1,
               lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
  };

  // Adjust a position to refer to the post-change position of the
  // same text, or the end of the change if the change covers it.
  function adjustForChange(pos, change) {
    if (cmp(pos, change.from) < 0) return pos;
    if (cmp(pos, change.to) <= 0) return changeEnd(change);

    var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
    if (pos.line == change.to.line) ch += changeEnd(change).ch - change.to.ch;
    return Pos(line, ch);
  }

  function computeSelAfterChange(doc, change) {
    var out = [];
    for (var i = 0; i < doc.sel.ranges.length; i++) {
      var range = doc.sel.ranges[i];
      out.push(new Range(adjustForChange(range.anchor, change),
                         adjustForChange(range.head, change)));
    }
    return normalizeSelection(out, doc.sel.primIndex);
  }

  function offsetPos(pos, old, nw) {
    if (pos.line == old.line)
      return Pos(nw.line, pos.ch - old.ch + nw.ch);
    else
      return Pos(nw.line + (pos.line - old.line), pos.ch);
  }

  // Used by replaceSelections to allow moving the selection to the
  // start or around the replaced test. Hint may be "start" or "around".
  function computeReplacedSel(doc, changes, hint) {
    var out = [];
    var oldPrev = Pos(doc.first, 0), newPrev = oldPrev;
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var from = offsetPos(change.from, oldPrev, newPrev);
      var to = offsetPos(changeEnd(change), oldPrev, newPrev);
      oldPrev = change.to;
      newPrev = to;
      if (hint == "around") {
        var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
        out[i] = new Range(inv ? to : from, inv ? from : to);
      } else {
        out[i] = new Range(from, from);
      }
    }
    return new Selection(out, doc.sel.primIndex);
  }

  // Allow "beforeChange" event handlers to influence a change
  function filterChange(doc, change, update) {
    var obj = {
      canceled: false,
      from: change.from,
      to: change.to,
      text: change.text,
      origin: change.origin,
      cancel: function() { this.canceled = true; }
    };
    if (update) obj.update = function(from, to, text, origin) {
      if (from) this.from = clipPos(doc, from);
      if (to) this.to = clipPos(doc, to);
      if (text) this.text = text;
      if (origin !== undefined) this.origin = origin;
    };
    signal(doc, "beforeChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

    if (obj.canceled) return null;
    return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
  }

  // Apply a change to a document, and add it to the document's
  // history, and propagating it to all linked documents.
  function makeChange(doc, change, ignoreReadOnly) {
    if (doc.cm) {
      if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly);
      if (doc.cm.state.suppressEdits) return;
    }

    if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
      change = filterChange(doc, change, true);
      if (!change) return;
    }

    // Possibly split or suppress the update based on the presence
    // of read-only spans in its range.
    var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
    if (split) {
      for (var i = split.length - 1; i >= 0; --i)
        makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text});
    } else {
      makeChangeInner(doc, change);
    }
  }

  function makeChangeInner(doc, change) {
    if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0) return;
    var selAfter = computeSelAfterChange(doc, change);
    addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

    makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
    var rebased = [];

    linkedDocs(doc, function(doc, sharedHist) {
      if (!sharedHist && indexOf(rebased, doc.history) == -1) {
        rebaseHist(doc.history, change);
        rebased.push(doc.history);
      }
      makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
    });
  }

  // Revert a change stored in a document's history.
  function makeChangeFromHistory(doc, type, allowSelectionOnly) {
    if (doc.cm && doc.cm.state.suppressEdits) return;

    var hist = doc.history, event, selAfter = doc.sel;
    var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

    // Verify that there is a useable event (so that ctrl-z won't
    // needlessly clear selection events)
    for (var i = 0; i < source.length; i++) {
      event = source[i];
      if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
        break;
    }
    if (i == source.length) return;
    hist.lastOrigin = hist.lastSelOrigin = null;

    for (;;) {
      event = source.pop();
      if (event.ranges) {
        pushSelectionToHistory(event, dest);
        if (allowSelectionOnly && !event.equals(doc.sel)) {
          setSelection(doc, event, {clearRedo: false});
          return;
        }
        selAfter = event;
      }
      else break;
    }

    // Build up a reverse change object to add to the opposite history
    // stack (redo when undoing, and vice versa).
    var antiChanges = [];
    pushSelectionToHistory(selAfter, dest);
    dest.push({changes: antiChanges, generation: hist.generation});
    hist.generation = event.generation || ++hist.maxGeneration;

    var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

    for (var i = event.changes.length - 1; i >= 0; --i) {
      var change = event.changes[i];
      change.origin = type;
      if (filter && !filterChange(doc, change, false)) {
        source.length = 0;
        return;
      }

      antiChanges.push(historyChangeFromChange(doc, change));

      var after = i ? computeSelAfterChange(doc, change) : lst(source);
      makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
      if (!i && doc.cm) doc.cm.scrollIntoView({from: change.from, to: changeEnd(change)});
      var rebased = [];

      // Propagate to the linked documents
      linkedDocs(doc, function(doc, sharedHist) {
        if (!sharedHist && indexOf(rebased, doc.history) == -1) {
          rebaseHist(doc.history, change);
          rebased.push(doc.history);
        }
        makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
      });
    }
  }

  // Sub-views need their line numbers shifted when text is added
  // above or below them in the parent document.
  function shiftDoc(doc, distance) {
    if (distance == 0) return;
    doc.first += distance;
    doc.sel = new Selection(map(doc.sel.ranges, function(range) {
      return new Range(Pos(range.anchor.line + distance, range.anchor.ch),
                       Pos(range.head.line + distance, range.head.ch));
    }), doc.sel.primIndex);
    if (doc.cm) {
      regChange(doc.cm, doc.first, doc.first - distance, distance);
      for (var d = doc.cm.display, l = d.viewFrom; l < d.viewTo; l++)
        regLineChange(doc.cm, l, "gutter");
    }
  }

  // More lower-level change function, handling only a single document
  // (not linked ones).
  function makeChangeSingleDoc(doc, change, selAfter, spans) {
    if (doc.cm && !doc.cm.curOp)
      return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

    if (change.to.line < doc.first) {
      shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
      return;
    }
    if (change.from.line > doc.lastLine()) return;

    // Clip the change to the size of this doc
    if (change.from.line < doc.first) {
      var shift = change.text.length - 1 - (doc.first - change.from.line);
      shiftDoc(doc, shift);
      change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
    }
    var last = doc.lastLine();
    if (change.to.line > last) {
      change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
    }

    change.removed = getBetween(doc, change.from, change.to);

    if (!selAfter) selAfter = computeSelAfterChange(doc, change);
    if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans);
    else updateDoc(doc, change, spans);
    setSelectionNoUndo(doc, selAfter, sel_dontScroll);
  }

  // Handle the interaction of a change to a document with the editor
  // that this document is part of.
  function makeChangeSingleDocInEditor(cm, change, spans) {
    var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

    var recomputeMaxLength = false, checkWidthStart = from.line;
    if (!cm.options.lineWrapping) {
      checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
      doc.iter(checkWidthStart, to.line + 1, function(line) {
        if (line == display.maxLine) {
          recomputeMaxLength = true;
          return true;
        }
      });
    }

    if (doc.sel.contains(change.from, change.to) > -1)
      signalCursorActivity(cm);

    updateDoc(doc, change, spans, estimateHeight(cm));

    if (!cm.options.lineWrapping) {
      doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
        var len = lineLength(line);
        if (len > display.maxLineLength) {
          display.maxLine = line;
          display.maxLineLength = len;
          display.maxLineChanged = true;
          recomputeMaxLength = false;
        }
      });
      if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
    }

    // Adjust frontier, schedule worker
    doc.frontier = Math.min(doc.frontier, from.line);
    startWorker(cm, 400);

    var lendiff = change.text.length - (to.line - from.line) - 1;
    // Remember that these lines changed, for updating the display
    if (change.full)
      regChange(cm);
    else if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
      regLineChange(cm, from.line, "text");
    else
      regChange(cm, from.line, to.line + 1, lendiff);

    var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
    if (changeHandler || changesHandler) {
      var obj = {
        from: from, to: to,
        text: change.text,
        removed: change.removed,
        origin: change.origin
      };
      if (changeHandler) signalLater(cm, "change", cm, obj);
      if (changesHandler) (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj);
    }
    cm.display.selForContextMenu = null;
  }

  function replaceRange(doc, code, from, to, origin) {
    if (!to) to = from;
    if (cmp(to, from) < 0) { var tmp = to; to = from; from = tmp; }
    if (typeof code == "string") code = splitLines(code);
    makeChange(doc, {from: from, to: to, text: code, origin: origin});
  }

  // SCROLLING THINGS INTO VIEW

  // If an editor sits on the top or bottom of the window, partially
  // scrolled out of view, this ensures that the cursor is visible.
  function maybeScrollWindow(cm, coords) {
    if (signalDOMEvent(cm, "scrollCursorIntoView")) return;

    var display = cm.display, box = display.sizer.getBoundingClientRect(), doScroll = null;
    if (coords.top + box.top < 0) doScroll = true;
    else if (coords.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight)) doScroll = false;
    if (doScroll != null && !phantom) {
      var scrollNode = elt("div", "\u200b", null, "position: absolute; top: " +
                           (coords.top - display.viewOffset - paddingTop(cm.display)) + "px; height: " +
                           (coords.bottom - coords.top + scrollGap(cm) + display.barHeight) + "px; left: " +
                           coords.left + "px; width: 2px;");
      cm.display.lineSpace.appendChild(scrollNode);
      scrollNode.scrollIntoView(doScroll);
      cm.display.lineSpace.removeChild(scrollNode);
    }
  }

  // Scroll a given position into view (immediately), verifying that
  // it actually became visible (as line heights are accurately
  // measured, the position of something may 'drift' during drawing).
  function scrollPosIntoView(cm, pos, end, margin) {
    if (margin == null) margin = 0;
    for (var limit = 0; limit < 5; limit++) {
      var changed = false, coords = cursorCoords(cm, pos);
      var endCoords = !end || end == pos ? coords : cursorCoords(cm, end);
      var scrollPos = calculateScrollPos(cm, Math.min(coords.left, endCoords.left),
                                         Math.min(coords.top, endCoords.top) - margin,
                                         Math.max(coords.left, endCoords.left),
                                         Math.max(coords.bottom, endCoords.bottom) + margin);
      var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
      if (scrollPos.scrollTop != null) {
        setScrollTop(cm, scrollPos.scrollTop);
        if (Math.abs(cm.doc.scrollTop - startTop) > 1) changed = true;
      }
      if (scrollPos.scrollLeft != null) {
        setScrollLeft(cm, scrollPos.scrollLeft);
        if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) changed = true;
      }
      if (!changed) break;
    }
    return coords;
  }

  // Scroll a given set of coordinates into view (immediately).
  function scrollIntoView(cm, x1, y1, x2, y2) {
    var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
    if (scrollPos.scrollTop != null) setScrollTop(cm, scrollPos.scrollTop);
    if (scrollPos.scrollLeft != null) setScrollLeft(cm, scrollPos.scrollLeft);
  }

  // Calculate a new scroll position needed to scroll the given
  // rectangle into view. Returns an object with scrollTop and
  // scrollLeft properties. When these are undefined, the
  // vertical/horizontal position does not need to be adjusted.
  function calculateScrollPos(cm, x1, y1, x2, y2) {
    var display = cm.display, snapMargin = textHeight(cm.display);
    if (y1 < 0) y1 = 0;
    var screentop = cm.curOp && cm.curOp.scrollTop != null ? cm.curOp.scrollTop : display.scroller.scrollTop;
    var screen = displayHeight(cm), result = {};
    if (y2 - y1 > screen) y2 = y1 + screen;
    var docBottom = cm.doc.height + paddingVert(display);
    var atTop = y1 < snapMargin, atBottom = y2 > docBottom - snapMargin;
    if (y1 < screentop) {
      result.scrollTop = atTop ? 0 : y1;
    } else if (y2 > screentop + screen) {
      var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
      if (newTop != screentop) result.scrollTop = newTop;
    }

    var screenleft = cm.curOp && cm.curOp.scrollLeft != null ? cm.curOp.scrollLeft : display.scroller.scrollLeft;
    var screenw = displayWidth(cm) - (cm.options.fixedGutter ? display.gutters.offsetWidth : 0);
    var tooWide = x2 - x1 > screenw;
    if (tooWide) x2 = x1 + screenw;
    if (x1 < 10)
      result.scrollLeft = 0;
    else if (x1 < screenleft)
      result.scrollLeft = Math.max(0, x1 - (tooWide ? 0 : 10));
    else if (x2 > screenw + screenleft - 3)
      result.scrollLeft = x2 + (tooWide ? 0 : 10) - screenw;
    return result;
  }

  // Store a relative adjustment to the scroll position in the current
  // operation (to be applied when the operation finishes).
  function addToScrollPos(cm, left, top) {
    if (left != null || top != null) resolveScrollToPos(cm);
    if (left != null)
      cm.curOp.scrollLeft = (cm.curOp.scrollLeft == null ? cm.doc.scrollLeft : cm.curOp.scrollLeft) + left;
    if (top != null)
      cm.curOp.scrollTop = (cm.curOp.scrollTop == null ? cm.doc.scrollTop : cm.curOp.scrollTop) + top;
  }

  // Make sure that at the end of the operation the current cursor is
  // shown.
  function ensureCursorVisible(cm) {
    resolveScrollToPos(cm);
    var cur = cm.getCursor(), from = cur, to = cur;
    if (!cm.options.lineWrapping) {
      from = cur.ch ? Pos(cur.line, cur.ch - 1) : cur;
      to = Pos(cur.line, cur.ch + 1);
    }
    cm.curOp.scrollToPos = {from: from, to: to, margin: cm.options.cursorScrollMargin, isCursor: true};
  }

  // When an operation has its scrollToPos property set, and another
  // scroll action is applied before the end of the operation, this
  // 'simulates' scrolling that position into view in a cheap way, so
  // that the effect of intermediate scroll commands is not ignored.
  function resolveScrollToPos(cm) {
    var range = cm.curOp.scrollToPos;
    if (range) {
      cm.curOp.scrollToPos = null;
      var from = estimateCoords(cm, range.from), to = estimateCoords(cm, range.to);
      var sPos = calculateScrollPos(cm, Math.min(from.left, to.left),
                                    Math.min(from.top, to.top) - range.margin,
                                    Math.max(from.right, to.right),
                                    Math.max(from.bottom, to.bottom) + range.margin);
      cm.scrollTo(sPos.scrollLeft, sPos.scrollTop);
    }
  }

  // API UTILITIES

  // Indent the given line. The how parameter can be "smart",
  // "add"/null, "subtract", or "prev". When aggressive is false
  // (typically set to true for forced single-line indents), empty
  // lines are not indented, and places where the mode returns Pass
  // are left alone.
  function indentLine(cm, n, how, aggressive) {
    var doc = cm.doc, state;
    if (how == null) how = "add";
    if (how == "smart") {
      // Fall back to "prev" when the mode doesn't have an indentation
      // method.
      if (!doc.mode.indent) how = "prev";
      else state = getStateBefore(cm, n);
    }

    var tabSize = cm.options.tabSize;
    var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
    if (line.stateAfter) line.stateAfter = null;
    var curSpaceString = line.text.match(/^\s*/)[0], indentation;
    if (!aggressive && !/\S/.test(line.text)) {
      indentation = 0;
      how = "not";
    } else if (how == "smart") {
      indentation = doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
      if (indentation == Pass || indentation > 150) {
        if (!aggressive) return;
        how = "prev";
      }
    }
    if (how == "prev") {
      if (n > doc.first) indentation = countColumn(getLine(doc, n-1).text, null, tabSize);
      else indentation = 0;
    } else if (how == "add") {
      indentation = curSpace + cm.options.indentUnit;
    } else if (how == "subtract") {
      indentation = curSpace - cm.options.indentUnit;
    } else if (typeof how == "number") {
      indentation = curSpace + how;
    }
    indentation = Math.max(0, indentation);

    var indentString = "", pos = 0;
    if (cm.options.indentWithTabs)
      for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";}
    if (pos < indentation) indentString += spaceStr(indentation - pos);

    if (indentString != curSpaceString) {
      replaceRange(doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
    } else {
      // Ensure that, if the cursor was in the whitespace at the start
      // of the line, it is moved to the end of that space.
      for (var i = 0; i < doc.sel.ranges.length; i++) {
        var range = doc.sel.ranges[i];
        if (range.head.line == n && range.head.ch < curSpaceString.length) {
          var pos = Pos(n, curSpaceString.length);
          replaceOneSelection(doc, i, new Range(pos, pos));
          break;
        }
      }
    }
    line.stateAfter = null;
  }

  // Utility for applying a change to a line by handle or number,
  // returning the number and optionally registering the line as
  // changed.
  function changeLine(doc, handle, changeType, op) {
    var no = handle, line = handle;
    if (typeof handle == "number") line = getLine(doc, clipLine(doc, handle));
    else no = lineNo(handle);
    if (no == null) return null;
    if (op(line, no) && doc.cm) regLineChange(doc.cm, no, changeType);
    return line;
  }

  // Helper for deleting text near the selection(s), used to implement
  // backspace, delete, and similar functionality.
  function deleteNearSelection(cm, compute) {
    var ranges = cm.doc.sel.ranges, kill = [];
    // Build up a set of ranges to kill first, merging overlapping
    // ranges.
    for (var i = 0; i < ranges.length; i++) {
      var toKill = compute(ranges[i]);
      while (kill.length && cmp(toKill.from, lst(kill).to) <= 0) {
        var replaced = kill.pop();
        if (cmp(replaced.from, toKill.from) < 0) {
          toKill.from = replaced.from;
          break;
        }
      }
      kill.push(toKill);
    }
    // Next, remove those actual ranges.
    runInOp(cm, function() {
      for (var i = kill.length - 1; i >= 0; i--)
        replaceRange(cm.doc, "", kill[i].from, kill[i].to, "+delete");
      ensureCursorVisible(cm);
    });
  }

  // Used for horizontal relative motion. Dir is -1 or 1 (left or
  // right), unit can be "char", "column" (like char, but doesn't
  // cross line boundaries), "word" (across next word), or "group" (to
  // the start of next group of word or non-word-non-whitespace
  // chars). The visually param controls whether, in right-to-left
  // text, direction 1 means to move towards the next index in the
  // string, or towards the character to the right of the current
  // position. The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosH(doc, pos, dir, unit, visually) {
    var line = pos.line, ch = pos.ch, origDir = dir;
    var lineObj = getLine(doc, line);
    var possible = true;
    function findNextLine() {
      var l = line + dir;
      if (l < doc.first || l >= doc.first + doc.size) return (possible = false);
      line = l;
      return lineObj = getLine(doc, l);
    }
    function moveOnce(boundToLine) {
      var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
      if (next == null) {
        if (!boundToLine && findNextLine()) {
          if (visually) ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
          else ch = dir < 0 ? lineObj.text.length : 0;
        } else return (possible = false);
      } else ch = next;
      return true;
    }

    if (unit == "char") moveOnce();
    else if (unit == "column") moveOnce(true);
    else if (unit == "word" || unit == "group") {
      var sawType = null, group = unit == "group";
      var helper = doc.cm && doc.cm.getHelper(pos, "wordChars");
      for (var first = true;; first = false) {
        if (dir < 0 && !moveOnce(!first)) break;
        var cur = lineObj.text.charAt(ch) || "\n";
        var type = isWordChar(cur, helper) ? "w"
          : group && cur == "\n" ? "n"
          : !group || /\s/.test(cur) ? null
          : "p";
        if (group && !first && !type) type = "s";
        if (sawType && sawType != type) {
          if (dir < 0) {dir = 1; moveOnce();}
          break;
        }

        if (type) sawType = type;
        if (dir > 0 && !moveOnce(!first)) break;
      }
    }
    var result = skipAtomic(doc, Pos(line, ch), origDir, true);
    if (!possible) result.hitSide = true;
    return result;
  }

  // For relative vertical movement. Dir may be -1 or 1. Unit can be
  // "page" or "line". The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosV(cm, pos, dir, unit) {
    var doc = cm.doc, x = pos.left, y;
    if (unit == "page") {
      var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
      y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
    } else if (unit == "line") {
      y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
    }
    for (;;) {
      var target = coordsChar(cm, x, y);
      if (!target.outside) break;
      if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break; }
      y += dir * 5;
    }
    return target;
  }

  // EDITOR METHODS

  // The publicly visible API. Note that methodOp(f) means
  // 'wrap f in an operation, performed on its `this` parameter'.

  // This is not the complete set of editor methods. Most of the
  // methods defined on the Doc type are also injected into
  // CodeMirror.prototype, for backwards compatibility and
  // convenience.

  CodeMirror.prototype = {
    constructor: CodeMirror,
    focus: function(){window.focus(); focusInput(this); fastPoll(this);},

    setOption: function(option, value) {
      var options = this.options, old = options[option];
      if (options[option] == value && option != "mode") return;
      options[option] = value;
      if (optionHandlers.hasOwnProperty(option))
        operation(this, optionHandlers[option])(this, value, old);
    },

    getOption: function(option) {return this.options[option];},
    getDoc: function() {return this.doc;},

    addKeyMap: function(map, bottom) {
      this.state.keyMaps[bottom ? "push" : "unshift"](getKeyMap(map));
    },
    removeKeyMap: function(map) {
      var maps = this.state.keyMaps;
      for (var i = 0; i < maps.length; ++i)
        if (maps[i] == map || maps[i].name == map) {
          maps.splice(i, 1);
          return true;
        }
    },

    addOverlay: methodOp(function(spec, options) {
      var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
      if (mode.startState) throw new Error("Overlays may not be stateful.");
      this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
      this.state.modeGen++;
      regChange(this);
    }),
    removeOverlay: methodOp(function(spec) {
      var overlays = this.state.overlays;
      for (var i = 0; i < overlays.length; ++i) {
        var cur = overlays[i].modeSpec;
        if (cur == spec || typeof spec == "string" && cur.name == spec) {
          overlays.splice(i, 1);
          this.state.modeGen++;
          regChange(this);
          return;
        }
      }
    }),

    indentLine: methodOp(function(n, dir, aggressive) {
      if (typeof dir != "string" && typeof dir != "number") {
        if (dir == null) dir = this.options.smartIndent ? "smart" : "prev";
        else dir = dir ? "add" : "subtract";
      }
      if (isLine(this.doc, n)) indentLine(this, n, dir, aggressive);
    }),
    indentSelection: methodOp(function(how) {
      var ranges = this.doc.sel.ranges, end = -1;
      for (var i = 0; i < ranges.length; i++) {
        var range = ranges[i];
        if (!range.empty()) {
          var from = range.from(), to = range.to();
          var start = Math.max(end, from.line);
          end = Math.min(this.lastLine(), to.line - (to.ch ? 0 : 1)) + 1;
          for (var j = start; j < end; ++j)
            indentLine(this, j, how);
          var newRanges = this.doc.sel.ranges;
          if (from.ch == 0 && ranges.length == newRanges.length && newRanges[i].from().ch > 0)
            replaceOneSelection(this.doc, i, new Range(from, newRanges[i].to()), sel_dontScroll);
        } else if (range.head.line > end) {
          indentLine(this, range.head.line, how, true);
          end = range.head.line;
          if (i == this.doc.sel.primIndex) ensureCursorVisible(this);
        }
      }
    }),

    // Fetch the parser token for a given character. Useful for hacks
    // that want to inspect the mode state (say, for completion).
    getTokenAt: function(pos, precise) {
      return takeToken(this, pos, precise);
    },

    getLineTokens: function(line, precise) {
      return takeToken(this, Pos(line), precise, true);
    },

    getTokenTypeAt: function(pos) {
      pos = clipPos(this.doc, pos);
      var styles = getLineStyles(this, getLine(this.doc, pos.line));
      var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
      var type;
      if (ch == 0) type = styles[2];
      else for (;;) {
        var mid = (before + after) >> 1;
        if ((mid ? styles[mid * 2 - 1] : 0) >= ch) after = mid;
        else if (styles[mid * 2 + 1] < ch) before = mid + 1;
        else { type = styles[mid * 2 + 2]; break; }
      }
      var cut = type ? type.indexOf("cm-overlay ") : -1;
      return cut < 0 ? type : cut == 0 ? null : type.slice(0, cut - 1);
    },

    getModeAt: function(pos) {
      var mode = this.doc.mode;
      if (!mode.innerMode) return mode;
      return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode;
    },

    getHelper: function(pos, type) {
      return this.getHelpers(pos, type)[0];
    },

    getHelpers: function(pos, type) {
      var found = [];
      if (!helpers.hasOwnProperty(type)) return helpers;
      var help = helpers[type], mode = this.getModeAt(pos);
      if (typeof mode[type] == "string") {
        if (help[mode[type]]) found.push(help[mode[type]]);
      } else if (mode[type]) {
        for (var i = 0; i < mode[type].length; i++) {
          var val = help[mode[type][i]];
          if (val) found.push(val);
        }
      } else if (mode.helperType && help[mode.helperType]) {
        found.push(help[mode.helperType]);
      } else if (help[mode.name]) {
        found.push(help[mode.name]);
      }
      for (var i = 0; i < help._global.length; i++) {
        var cur = help._global[i];
        if (cur.pred(mode, this) && indexOf(found, cur.val) == -1)
          found.push(cur.val);
      }
      return found;
    },

    getStateAfter: function(line, precise) {
      var doc = this.doc;
      line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
      return getStateBefore(this, line + 1, precise);
    },

    cursorCoords: function(start, mode) {
      var pos, range = this.doc.sel.primary();
      if (start == null) pos = range.head;
      else if (typeof start == "object") pos = clipPos(this.doc, start);
      else pos = start ? range.from() : range.to();
      return cursorCoords(this, pos, mode || "page");
    },

    charCoords: function(pos, mode) {
      return charCoords(this, clipPos(this.doc, pos), mode || "page");
    },

    coordsChar: function(coords, mode) {
      coords = fromCoordSystem(this, coords, mode || "page");
      return coordsChar(this, coords.left, coords.top);
    },

    lineAtHeight: function(height, mode) {
      height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
      return lineAtHeight(this.doc, height + this.display.viewOffset);
    },
    heightAtLine: function(line, mode) {
      var end = false, last = this.doc.first + this.doc.size - 1;
      if (line < this.doc.first) line = this.doc.first;
      else if (line > last) { line = last; end = true; }
      var lineObj = getLine(this.doc, line);
      return intoCoordSystem(this, lineObj, {top: 0, left: 0}, mode || "page").top +
        (end ? this.doc.height - heightAtLine(lineObj) : 0);
    },

    defaultTextHeight: function() { return textHeight(this.display); },
    defaultCharWidth: function() { return charWidth(this.display); },

    setGutterMarker: methodOp(function(line, gutterID, value) {
      return changeLine(this.doc, line, "gutter", function(line) {
        var markers = line.gutterMarkers || (line.gutterMarkers = {});
        markers[gutterID] = value;
        if (!value && isEmpty(markers)) line.gutterMarkers = null;
        return true;
      });
    }),

    clearGutter: methodOp(function(gutterID) {
      var cm = this, doc = cm.doc, i = doc.first;
      doc.iter(function(line) {
        if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
          line.gutterMarkers[gutterID] = null;
          regLineChange(cm, i, "gutter");
          if (isEmpty(line.gutterMarkers)) line.gutterMarkers = null;
        }
        ++i;
      });
    }),

    addLineWidget: methodOp(function(handle, node, options) {
      return addLineWidget(this, handle, node, options);
    }),

    removeLineWidget: function(widget) { widget.clear(); },

    lineInfo: function(line) {
      if (typeof line == "number") {
        if (!isLine(this.doc, line)) return null;
        var n = line;
        line = getLine(this.doc, line);
        if (!line) return null;
      } else {
        var n = lineNo(line);
        if (n == null) return null;
      }
      return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
              textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
              widgets: line.widgets};
    },

    getViewport: function() { return {from: this.display.viewFrom, to: this.display.viewTo};},

    addWidget: function(pos, node, scroll, vert, horiz) {
      var display = this.display;
      pos = cursorCoords(this, clipPos(this.doc, pos));
      var top = pos.bottom, left = pos.left;
      node.style.position = "absolute";
      node.setAttribute("cm-ignore-events", "true");
      display.sizer.appendChild(node);
      if (vert == "over") {
        top = pos.top;
      } else if (vert == "above" || vert == "near") {
        var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
        // Default to positioning above (if specified and possible); otherwise default to positioning below
        if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
          top = pos.top - node.offsetHeight;
        else if (pos.bottom + node.offsetHeight <= vspace)
          top = pos.bottom;
        if (left + node.offsetWidth > hspace)
          left = hspace - node.offsetWidth;
      }
      node.style.top = top + "px";
      node.style.left = node.style.right = "";
      if (horiz == "right") {
        left = display.sizer.clientWidth - node.offsetWidth;
        node.style.right = "0px";
      } else {
        if (horiz == "left") left = 0;
        else if (horiz == "middle") left = (display.sizer.clientWidth - node.offsetWidth) / 2;
        node.style.left = left + "px";
      }
      if (scroll)
        scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
    },

    triggerOnKeyDown: methodOp(onKeyDown),
    triggerOnKeyPress: methodOp(onKeyPress),
    triggerOnKeyUp: onKeyUp,

    execCommand: function(cmd) {
      if (commands.hasOwnProperty(cmd))
        return commands[cmd](this);
    },

    findPosH: function(from, amount, unit, visually) {
      var dir = 1;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        cur = findPosH(this.doc, cur, dir, unit, visually);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveH: methodOp(function(dir, unit) {
      var cm = this;
      cm.extendSelectionsBy(function(range) {
        if (cm.display.shift || cm.doc.extend || range.empty())
          return findPosH(cm.doc, range.head, dir, unit, cm.options.rtlMoveVisually);
        else
          return dir < 0 ? range.from() : range.to();
      }, sel_move);
    }),

    deleteH: methodOp(function(dir, unit) {
      var sel = this.doc.sel, doc = this.doc;
      if (sel.somethingSelected())
        doc.replaceSelection("", null, "+delete");
      else
        deleteNearSelection(this, function(range) {
          var other = findPosH(doc, range.head, dir, unit, false);
          return dir < 0 ? {from: other, to: range.head} : {from: range.head, to: other};
        });
    }),

    findPosV: function(from, amount, unit, goalColumn) {
      var dir = 1, x = goalColumn;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        var coords = cursorCoords(this, cur, "div");
        if (x == null) x = coords.left;
        else coords.left = x;
        cur = findPosV(this, coords, dir, unit);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveV: methodOp(function(dir, unit) {
      var cm = this, doc = this.doc, goals = [];
      var collapse = !cm.display.shift && !doc.extend && doc.sel.somethingSelected();
      doc.extendSelectionsBy(function(range) {
        if (collapse)
          return dir < 0 ? range.from() : range.to();
        var headPos = cursorCoords(cm, range.head, "div");
        if (range.goalColumn != null) headPos.left = range.goalColumn;
        goals.push(headPos.left);
        var pos = findPosV(cm, headPos, dir, unit);
        if (unit == "page" && range == doc.sel.primary())
          addToScrollPos(cm, null, charCoords(cm, pos, "div").top - headPos.top);
        return pos;
      }, sel_move);
      if (goals.length) for (var i = 0; i < doc.sel.ranges.length; i++)
        doc.sel.ranges[i].goalColumn = goals[i];
    }),

    // Find the word at the given position (as returned by coordsChar).
    findWordAt: function(pos) {
      var doc = this.doc, line = getLine(doc, pos.line).text;
      var start = pos.ch, end = pos.ch;
      if (line) {
        var helper = this.getHelper(pos, "wordChars");
        if ((pos.xRel < 0 || end == line.length) && start) --start; else ++end;
        var startChar = line.charAt(start);
        var check = isWordChar(startChar, helper)
          ? function(ch) { return isWordChar(ch, helper); }
          : /\s/.test(startChar) ? function(ch) {return /\s/.test(ch);}
          : function(ch) {return !/\s/.test(ch) && !isWordChar(ch);};
        while (start > 0 && check(line.charAt(start - 1))) --start;
        while (end < line.length && check(line.charAt(end))) ++end;
      }
      return new Range(Pos(pos.line, start), Pos(pos.line, end));
    },

    toggleOverwrite: function(value) {
      if (value != null && value == this.state.overwrite) return;
      if (this.state.overwrite = !this.state.overwrite)
        addClass(this.display.cursorDiv, "CodeMirror-overwrite");
      else
        rmClass(this.display.cursorDiv, "CodeMirror-overwrite");

      signal(this, "overwriteToggle", this, this.state.overwrite);
    },
    hasFocus: function() { return activeElt() == this.display.input; },

    scrollTo: methodOp(function(x, y) {
      if (x != null || y != null) resolveScrollToPos(this);
      if (x != null) this.curOp.scrollLeft = x;
      if (y != null) this.curOp.scrollTop = y;
    }),
    getScrollInfo: function() {
      var scroller = this.display.scroller;
      return {left: scroller.scrollLeft, top: scroller.scrollTop,
              height: scroller.scrollHeight - scrollGap(this) - this.display.barHeight,
              width: scroller.scrollWidth - scrollGap(this) - this.display.barWidth,
              clientHeight: displayHeight(this), clientWidth: displayWidth(this)};
    },

    scrollIntoView: methodOp(function(range, margin) {
      if (range == null) {
        range = {from: this.doc.sel.primary().head, to: null};
        if (margin == null) margin = this.options.cursorScrollMargin;
      } else if (typeof range == "number") {
        range = {from: Pos(range, 0), to: null};
      } else if (range.from == null) {
        range = {from: range, to: null};
      }
      if (!range.to) range.to = range.from;
      range.margin = margin || 0;

      if (range.from.line != null) {
        resolveScrollToPos(this);
        this.curOp.scrollToPos = range;
      } else {
        var sPos = calculateScrollPos(this, Math.min(range.from.left, range.to.left),
                                      Math.min(range.from.top, range.to.top) - range.margin,
                                      Math.max(range.from.right, range.to.right),
                                      Math.max(range.from.bottom, range.to.bottom) + range.margin);
        this.scrollTo(sPos.scrollLeft, sPos.scrollTop);
      }
    }),

    setSize: methodOp(function(width, height) {
      var cm = this;
      function interpret(val) {
        return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
      }
      if (width != null) cm.display.wrapper.style.width = interpret(width);
      if (height != null) cm.display.wrapper.style.height = interpret(height);
      if (cm.options.lineWrapping) clearLineMeasurementCache(this);
      var lineNo = cm.display.viewFrom;
      cm.doc.iter(lineNo, cm.display.viewTo, function(line) {
        if (line.widgets) for (var i = 0; i < line.widgets.length; i++)
          if (line.widgets[i].noHScroll) { regLineChange(cm, lineNo, "widget"); break; }
        ++lineNo;
      });
      cm.curOp.forceUpdate = true;
      signal(cm, "refresh", this);
    }),

    operation: function(f){return runInOp(this, f);},

    refresh: methodOp(function() {
      var oldHeight = this.display.cachedTextHeight;
      regChange(this);
      this.curOp.forceUpdate = true;
      clearCaches(this);
      this.scrollTo(this.doc.scrollLeft, this.doc.scrollTop);
      updateGutterSpace(this);
      if (oldHeight == null || Math.abs(oldHeight - textHeight(this.display)) > .5)
        estimateLineHeights(this);
      signal(this, "refresh", this);
    }),

    swapDoc: methodOp(function(doc) {
      var old = this.doc;
      old.cm = null;
      attachDoc(this, doc);
      clearCaches(this);
      resetInput(this);
      this.scrollTo(doc.scrollLeft, doc.scrollTop);
      this.curOp.forceScroll = true;
      signalLater(this, "swapDoc", this, old);
      return old;
    }),

    getInputField: function(){return this.display.input;},
    getWrapperElement: function(){return this.display.wrapper;},
    getScrollerElement: function(){return this.display.scroller;},
    getGutterElement: function(){return this.display.gutters;}
  };
  eventMixin(CodeMirror);

  // OPTION DEFAULTS

  // The default configuration options.
  var defaults = CodeMirror.defaults = {};
  // Functions to run when options are changed.
  var optionHandlers = CodeMirror.optionHandlers = {};

  function option(name, deflt, handle, notOnInit) {
    CodeMirror.defaults[name] = deflt;
    if (handle) optionHandlers[name] =
      notOnInit ? function(cm, val, old) {if (old != Init) handle(cm, val, old);} : handle;
  }

  // Passed to option handlers when there is no old value.
  var Init = CodeMirror.Init = {toString: function(){return "CodeMirror.Init";}};

  // These two are, on init, called from the constructor because they
  // have to be initialized before the editor can start at all.
  option("value", "", function(cm, val) {
    cm.setValue(val);
  }, true);
  option("mode", null, function(cm, val) {
    cm.doc.modeOption = val;
    loadMode(cm);
  }, true);

  option("indentUnit", 2, loadMode, true);
  option("indentWithTabs", false);
  option("smartIndent", true);
  option("tabSize", 4, function(cm) {
    resetModeState(cm);
    clearCaches(cm);
    regChange(cm);
  }, true);
  option("specialChars", /[\t\u0000-\u0019\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, function(cm, val) {
    cm.options.specialChars = new RegExp(val.source + (val.test("\t") ? "" : "|\t"), "g");
    cm.refresh();
  }, true);
  option("specialCharPlaceholder", defaultSpecialCharPlaceholder, function(cm) {cm.refresh();}, true);
  option("electricChars", true);
  option("rtlMoveVisually", !windows);
  option("wholeLineUpdateBefore", true);

  option("theme", "default", function(cm) {
    themeChanged(cm);
    guttersChanged(cm);
  }, true);
  option("keyMap", "default", function(cm, val, old) {
    var next = getKeyMap(val);
    var prev = old != CodeMirror.Init && getKeyMap(old);
    if (prev && prev.detach) prev.detach(cm, next);
    if (next.attach) next.attach(cm, prev || null);
  });
  option("extraKeys", null);

  option("lineWrapping", false, wrappingChanged, true);
  option("gutters", [], function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("fixedGutter", true, function(cm, val) {
    cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
    cm.refresh();
  }, true);
  option("coverGutterNextToScrollbar", false, function(cm) {updateScrollbars(cm);}, true);
  option("scrollbarStyle", "native", function(cm) {
    initScrollbars(cm);
    updateScrollbars(cm);
    cm.display.scrollbars.setScrollTop(cm.doc.scrollTop);
    cm.display.scrollbars.setScrollLeft(cm.doc.scrollLeft);
  }, true);
  option("lineNumbers", false, function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("firstLineNumber", 1, guttersChanged, true);
  option("lineNumberFormatter", function(integer) {return integer;}, guttersChanged, true);
  option("showCursorWhenSelecting", false, updateSelection, true);

  option("resetSelectionOnContextMenu", true);

  option("readOnly", false, function(cm, val) {
    if (val == "nocursor") {
      onBlur(cm);
      cm.display.input.blur();
      cm.display.disabled = true;
    } else {
      cm.display.disabled = false;
      if (!val) resetInput(cm);
    }
  });
  option("disableInput", false, function(cm, val) {if (!val) resetInput(cm);}, true);
  option("dragDrop", true);

  option("cursorBlinkRate", 530);
  option("cursorScrollMargin", 0);
  option("cursorHeight", 1, updateSelection, true);
  option("singleCursorHeightPerLine", true, updateSelection, true);
  option("workTime", 100);
  option("workDelay", 100);
  option("flattenSpans", true, resetModeState, true);
  option("addModeClass", false, resetModeState, true);
  option("pollInterval", 100);
  option("undoDepth", 200, function(cm, val){cm.doc.history.undoDepth = val;});
  option("historyEventDelay", 1250);
  option("viewportMargin", 10, function(cm){cm.refresh();}, true);
  option("maxHighlightLength", 10000, resetModeState, true);
  option("moveInputWithCursor", true, function(cm, val) {
    if (!val) cm.display.inputDiv.style.top = cm.display.inputDiv.style.left = 0;
  });

  option("tabindex", null, function(cm, val) {
    cm.display.input.tabIndex = val || "";
  });
  option("autofocus", null);

  // MODE DEFINITION AND QUERYING

  // Known modes, by name and by MIME
  var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

  // Extra arguments are stored as the mode's dependencies, which is
  // used by (legacy) mechanisms like loadmode.js to automatically
  // load a mode. (Preferred mechanism is the require/define calls.)
  CodeMirror.defineMode = function(name, mode) {
    if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name;
    if (arguments.length > 2)
      mode.dependencies = Array.prototype.slice.call(arguments, 2);
    modes[name] = mode;
  };

  CodeMirror.defineMIME = function(mime, spec) {
    mimeModes[mime] = spec;
  };

  // Given a MIME type, a {name, ...options} config object, or a name
  // string, return a mode config object.
  CodeMirror.resolveMode = function(spec) {
    if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
      spec = mimeModes[spec];
    } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
      var found = mimeModes[spec.name];
      if (typeof found == "string") found = {name: found};
      spec = createObj(found, spec);
      spec.name = found.name;
    } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
      return CodeMirror.resolveMode("application/xml");
    }
    if (typeof spec == "string") return {name: spec};
    else return spec || {name: "null"};
  };

  // Given a mode spec (anything that resolveMode accepts), find and
  // initialize an actual mode object.
  CodeMirror.getMode = function(options, spec) {
    var spec = CodeMirror.resolveMode(spec);
    var mfactory = modes[spec.name];
    if (!mfactory) return CodeMirror.getMode(options, "text/plain");
    var modeObj = mfactory(options, spec);
    if (modeExtensions.hasOwnProperty(spec.name)) {
      var exts = modeExtensions[spec.name];
      for (var prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue;
        if (modeObj.hasOwnProperty(prop)) modeObj["_" + prop] = modeObj[prop];
        modeObj[prop] = exts[prop];
      }
    }
    modeObj.name = spec.name;
    if (spec.helperType) modeObj.helperType = spec.helperType;
    if (spec.modeProps) for (var prop in spec.modeProps)
      modeObj[prop] = spec.modeProps[prop];

    return modeObj;
  };

  // Minimal default mode.
  CodeMirror.defineMode("null", function() {
    return {token: function(stream) {stream.skipToEnd();}};
  });
  CodeMirror.defineMIME("text/plain", "null");

  // This can be used to attach properties to mode objects from
  // outside the actual mode definition.
  var modeExtensions = CodeMirror.modeExtensions = {};
  CodeMirror.extendMode = function(mode, properties) {
    var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
    copyObj(properties, exts);
  };

  // EXTENSIONS

  CodeMirror.defineExtension = function(name, func) {
    CodeMirror.prototype[name] = func;
  };
  CodeMirror.defineDocExtension = function(name, func) {
    Doc.prototype[name] = func;
  };
  CodeMirror.defineOption = option;

  var initHooks = [];
  CodeMirror.defineInitHook = function(f) {initHooks.push(f);};

  var helpers = CodeMirror.helpers = {};
  CodeMirror.registerHelper = function(type, name, value) {
    if (!helpers.hasOwnProperty(type)) helpers[type] = CodeMirror[type] = {_global: []};
    helpers[type][name] = value;
  };
  CodeMirror.registerGlobalHelper = function(type, name, predicate, value) {
    CodeMirror.registerHelper(type, name, value);
    helpers[type]._global.push({pred: predicate, val: value});
  };

  // MODE STATE HANDLING

  // Utility functions for working with state. Exported because nested
  // modes need to do this for their inner modes.

  var copyState = CodeMirror.copyState = function(mode, state) {
    if (state === true) return state;
    if (mode.copyState) return mode.copyState(state);
    var nstate = {};
    for (var n in state) {
      var val = state[n];
      if (val instanceof Array) val = val.concat([]);
      nstate[n] = val;
    }
    return nstate;
  };

  var startState = CodeMirror.startState = function(mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : true;
  };

  // Given a mode and a state (for that mode), find the inner mode and
  // state at the position that the state refers to.
  CodeMirror.innerMode = function(mode, state) {
    while (mode.innerMode) {
      var info = mode.innerMode(state);
      if (!info || info.mode == mode) break;
      state = info.state;
      mode = info.mode;
    }
    return info || {mode: mode, state: state};
  };

  // STANDARD COMMANDS

  // Commands are parameter-less actions that can be performed on an
  // editor, mostly used for keybindings.
  var commands = CodeMirror.commands = {
    selectAll: function(cm) {cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()), sel_dontScroll);},
    singleSelection: function(cm) {
      cm.setSelection(cm.getCursor("anchor"), cm.getCursor("head"), sel_dontScroll);
    },
    killLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        if (range.empty()) {
          var len = getLine(cm.doc, range.head.line).text.length;
          if (range.head.ch == len && range.head.line < cm.lastLine())
            return {from: range.head, to: Pos(range.head.line + 1, 0)};
          else
            return {from: range.head, to: Pos(range.head.line, len)};
        } else {
          return {from: range.from(), to: range.to()};
        }
      });
    },
    deleteLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0),
                to: clipPos(cm.doc, Pos(range.to().line + 1, 0))};
      });
    },
    delLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0), to: range.from()};
      });
    },
    delWrappedLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var leftPos = cm.coordsChar({left: 0, top: top}, "div");
        return {from: leftPos, to: range.from()};
      });
    },
    delWrappedLineRight: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var rightPos = cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
        return {from: range.from(), to: rightPos };
      });
    },
    undo: function(cm) {cm.undo();},
    redo: function(cm) {cm.redo();},
    undoSelection: function(cm) {cm.undoSelection();},
    redoSelection: function(cm) {cm.redoSelection();},
    goDocStart: function(cm) {cm.extendSelection(Pos(cm.firstLine(), 0));},
    goDocEnd: function(cm) {cm.extendSelection(Pos(cm.lastLine()));},
    goLineStart: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineStart(cm, range.head.line); },
                            {origin: "+move", bias: 1});
    },
    goLineStartSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        return lineStartSmart(cm, range.head);
      }, {origin: "+move", bias: 1});
    },
    goLineEnd: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineEnd(cm, range.head.line); },
                            {origin: "+move", bias: -1});
    },
    goLineRight: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
      }, sel_move);
    },
    goLineLeft: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: 0, top: top}, "div");
      }, sel_move);
    },
    goLineLeftSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var pos = cm.coordsChar({left: 0, top: top}, "div");
        if (pos.ch < cm.getLine(pos.line).search(/\S/)) return lineStartSmart(cm, range.head);
        return pos;
      }, sel_move);
    },
    goLineUp: function(cm) {cm.moveV(-1, "line");},
    goLineDown: function(cm) {cm.moveV(1, "line");},
    goPageUp: function(cm) {cm.moveV(-1, "page");},
    goPageDown: function(cm) {cm.moveV(1, "page");},
    goCharLeft: function(cm) {cm.moveH(-1, "char");},
    goCharRight: function(cm) {cm.moveH(1, "char");},
    goColumnLeft: function(cm) {cm.moveH(-1, "column");},
    goColumnRight: function(cm) {cm.moveH(1, "column");},
    goWordLeft: function(cm) {cm.moveH(-1, "word");},
    goGroupRight: function(cm) {cm.moveH(1, "group");},
    goGroupLeft: function(cm) {cm.moveH(-1, "group");},
    goWordRight: function(cm) {cm.moveH(1, "word");},
    delCharBefore: function(cm) {cm.deleteH(-1, "char");},
    delCharAfter: function(cm) {cm.deleteH(1, "char");},
    delWordBefore: function(cm) {cm.deleteH(-1, "word");},
    delWordAfter: function(cm) {cm.deleteH(1, "word");},
    delGroupBefore: function(cm) {cm.deleteH(-1, "group");},
    delGroupAfter: function(cm) {cm.deleteH(1, "group");},
    indentAuto: function(cm) {cm.indentSelection("smart");},
    indentMore: function(cm) {cm.indentSelection("add");},
    indentLess: function(cm) {cm.indentSelection("subtract");},
    insertTab: function(cm) {cm.replaceSelection("\t");},
    insertSoftTab: function(cm) {
      var spaces = [], ranges = cm.listSelections(), tabSize = cm.options.tabSize;
      for (var i = 0; i < ranges.length; i++) {
        var pos = ranges[i].from();
        var col = countColumn(cm.getLine(pos.line), pos.ch, tabSize);
        spaces.push(new Array(tabSize - col % tabSize + 1).join(" "));
      }
      cm.replaceSelections(spaces);
    },
    defaultTab: function(cm) {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.execCommand("insertTab");
    },
    transposeChars: function(cm) {
      runInOp(cm, function() {
        var ranges = cm.listSelections(), newSel = [];
        for (var i = 0; i < ranges.length; i++) {
          var cur = ranges[i].head, line = getLine(cm.doc, cur.line).text;
          if (line) {
            if (cur.ch == line.length) cur = new Pos(cur.line, cur.ch - 1);
            if (cur.ch > 0) {
              cur = new Pos(cur.line, cur.ch + 1);
              cm.replaceRange(line.charAt(cur.ch - 1) + line.charAt(cur.ch - 2),
                              Pos(cur.line, cur.ch - 2), cur, "+transpose");
            } else if (cur.line > cm.doc.first) {
              var prev = getLine(cm.doc, cur.line - 1).text;
              if (prev)
                cm.replaceRange(line.charAt(0) + "\n" + prev.charAt(prev.length - 1),
                                Pos(cur.line - 1, prev.length - 1), Pos(cur.line, 1), "+transpose");
            }
          }
          newSel.push(new Range(cur, cur));
        }
        cm.setSelections(newSel);
      });
    },
    newlineAndIndent: function(cm) {
      runInOp(cm, function() {
        var len = cm.listSelections().length;
        for (var i = 0; i < len; i++) {
          var range = cm.listSelections()[i];
          cm.replaceRange("\n", range.anchor, range.head, "+input");
          cm.indentLine(range.from().line + 1, null, true);
          ensureCursorVisible(cm);
        }
      });
    },
    toggleOverwrite: function(cm) {cm.toggleOverwrite();}
  };


  // STANDARD KEYMAPS

  var keyMap = CodeMirror.keyMap = {};

  keyMap.basic = {
    "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
    "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
    "Delete": "delCharAfter", "Backspace": "delCharBefore", "Shift-Backspace": "delCharBefore",
    "Tab": "defaultTab", "Shift-Tab": "indentAuto",
    "Enter": "newlineAndIndent", "Insert": "toggleOverwrite",
    "Esc": "singleSelection"
  };
  // Note that the save and find-related commands aren't defined by
  // default. User code or addons can define them. Unknown commands
  // are simply ignored.
  keyMap.pcDefault = {
    "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
    "Ctrl-Home": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Up": "goLineUp", "Ctrl-Down": "goLineDown",
    "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
    "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
    "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
    "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
    "Ctrl-U": "undoSelection", "Shift-Ctrl-U": "redoSelection", "Alt-U": "redoSelection",
    fallthrough: "basic"
  };
  // Very basic readline/emacs-style bindings, which are standard on Mac.
  keyMap.emacsy = {
    "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
    "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
    "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
    "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
  };
  keyMap.macDefault = {
    "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
    "Cmd-Home": "goDocStart", "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
    "Alt-Right": "goGroupRight", "Cmd-Left": "goLineLeft", "Cmd-Right": "goLineRight", "Alt-Backspace": "delGroupBefore",
    "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
    "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
    "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delWrappedLineLeft", "Cmd-Delete": "delWrappedLineRight",
    "Cmd-U": "undoSelection", "Shift-Cmd-U": "redoSelection", "Ctrl-Up": "goDocStart", "Ctrl-Down": "goDocEnd",
    fallthrough: ["basic", "emacsy"]
  };
  keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;

  // KEYMAP DISPATCH

  function normalizeKeyName(name) {
    var parts = name.split(/-(?!$)/), name = parts[parts.length - 1];
    var alt, ctrl, shift, cmd;
    for (var i = 0; i < parts.length - 1; i++) {
      var mod = parts[i];
      if (/^(cmd|meta|m)$/i.test(mod)) cmd = true;
      else if (/^a(lt)?$/i.test(mod)) alt = true;
      else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true;
      else if (/^s(hift)$/i.test(mod)) shift = true;
      else throw new Error("Unrecognized modifier name: " + mod);
    }
    if (alt) name = "Alt-" + name;
    if (ctrl) name = "Ctrl-" + name;
    if (cmd) name = "Cmd-" + name;
    if (shift) name = "Shift-" + name;
    return name;
  }

  // This is a kludge to keep keymaps mostly working as raw objects
  // (backwards compatibility) while at the same time support features
  // like normalization and multi-stroke key bindings. It compiles a
  // new normalized keymap, and then updates the old object to reflect
  // this.
  CodeMirror.normalizeKeyMap = function(keymap) {
    var copy = {};
    for (var keyname in keymap) if (keymap.hasOwnProperty(keyname)) {
      var value = keymap[keyname];
      if (/^(name|fallthrough|(de|at)tach)$/.test(keyname)) continue;
      if (value == "...") { delete keymap[keyname]; continue; }

      var keys = map(keyname.split(" "), normalizeKeyName);
      for (var i = 0; i < keys.length; i++) {
        var val, name;
        if (i == keys.length - 1) {
          name = keyname;
          val = value;
        } else {
          name = keys.slice(0, i + 1).join(" ");
          val = "...";
        }
        var prev = copy[name];
        if (!prev) copy[name] = val;
        else if (prev != val) throw new Error("Inconsistent bindings for " + name);
      }
      delete keymap[keyname];
    }
    for (var prop in copy) keymap[prop] = copy[prop];
    return keymap;
  };

  var lookupKey = CodeMirror.lookupKey = function(key, map, handle, context) {
    map = getKeyMap(map);
    var found = map.call ? map.call(key, context) : map[key];
    if (found === false) return "nothing";
    if (found === "...") return "multi";
    if (found != null && handle(found)) return "handled";

    if (map.fallthrough) {
      if (Object.prototype.toString.call(map.fallthrough) != "[object Array]")
        return lookupKey(key, map.fallthrough, handle, context);
      for (var i = 0; i < map.fallthrough.length; i++) {
        var result = lookupKey(key, map.fallthrough[i], handle, context);
        if (result) return result;
      }
    }
  };

  // Modifier key presses don't count as 'real' key presses for the
  // purpose of keymap fallthrough.
  var isModifierKey = CodeMirror.isModifierKey = function(value) {
    var name = typeof value == "string" ? value : keyNames[value.keyCode];
    return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
  };

  // Look up the name of a key as indicated by an event object.
  var keyName = CodeMirror.keyName = function(event, noShift) {
    if (presto && event.keyCode == 34 && event["char"]) return false;
    var base = keyNames[event.keyCode], name = base;
    if (name == null || event.altGraphKey) return false;
    if (event.altKey && base != "Alt") name = "Alt-" + name;
    if ((flipCtrlCmd ? event.metaKey : event.ctrlKey) && base != "Ctrl") name = "Ctrl-" + name;
    if ((flipCtrlCmd ? event.ctrlKey : event.metaKey) && base != "Cmd") name = "Cmd-" + name;
    if (!noShift && event.shiftKey && base != "Shift") name = "Shift-" + name;
    return name;
  };

  function getKeyMap(val) {
    return typeof val == "string" ? keyMap[val] : val;
  }

  // FROMTEXTAREA

  CodeMirror.fromTextArea = function(textarea, options) {
    if (!options) options = {};
    options.value = textarea.value;
    if (!options.tabindex && textarea.tabindex)
      options.tabindex = textarea.tabindex;
    if (!options.placeholder && textarea.placeholder)
      options.placeholder = textarea.placeholder;
    // Set autofocus to true if this textarea is focused, or if it has
    // autofocus and no other element is focused.
    if (options.autofocus == null) {
      var hasFocus = activeElt();
      options.autofocus = hasFocus == textarea ||
        textarea.getAttribute("autofocus") != null && hasFocus == document.body;
    }

    function save() {textarea.value = cm.getValue();}
    if (textarea.form) {
      on(textarea.form, "submit", save);
      // Deplorable hack to make the submit method do the right thing.
      if (!options.leaveSubmitMethodAlone) {
        var form = textarea.form, realSubmit = form.submit;
        try {
          var wrappedSubmit = form.submit = function() {
            save();
            form.submit = realSubmit;
            form.submit();
            form.submit = wrappedSubmit;
          };
        } catch(e) {}
      }
    }

    textarea.style.display = "none";
    var cm = CodeMirror(function(node) {
      textarea.parentNode.insertBefore(node, textarea.nextSibling);
    }, options);
    cm.save = save;
    cm.getTextArea = function() { return textarea; };
    cm.toTextArea = function() {
      cm.toTextArea = isNaN; // Prevent this from being ran twice
      save();
      textarea.parentNode.removeChild(cm.getWrapperElement());
      textarea.style.display = "";
      if (textarea.form) {
        off(textarea.form, "submit", save);
        if (typeof textarea.form.submit == "function")
          textarea.form.submit = realSubmit;
      }
    };
    return cm;
  };

  // STRING STREAM

  // Fed to the mode parsers, provides helper functions to make
  // parsers more succinct.

  var StringStream = CodeMirror.StringStream = function(string, tabSize) {
    this.pos = this.start = 0;
    this.string = string;
    this.tabSize = tabSize || 8;
    this.lastColumnPos = this.lastColumnValue = 0;
    this.lineStart = 0;
  };

  StringStream.prototype = {
    eol: function() {return this.pos >= this.string.length;},
    sol: function() {return this.pos == this.lineStart;},
    peek: function() {return this.string.charAt(this.pos) || undefined;},
    next: function() {
      if (this.pos < this.string.length)
        return this.string.charAt(this.pos++);
    },
    eat: function(match) {
      var ch = this.string.charAt(this.pos);
      if (typeof match == "string") var ok = ch == match;
      else var ok = ch && (match.test ? match.test(ch) : match(ch));
      if (ok) {++this.pos; return ch;}
    },
    eatWhile: function(match) {
      var start = this.pos;
      while (this.eat(match)){}
      return this.pos > start;
    },
    eatSpace: function() {
      var start = this.pos;
      while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
      return this.pos > start;
    },
    skipToEnd: function() {this.pos = this.string.length;},
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {this.pos = found; return true;}
    },
    backUp: function(n) {this.pos -= n;},
    column: function() {
      if (this.lastColumnPos < this.start) {
        this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
        this.lastColumnPos = this.start;
      }
      return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    indentation: function() {
      return countColumn(this.string, null, this.tabSize) -
        (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    match: function(pattern, consume, caseInsensitive) {
      if (typeof pattern == "string") {
        var cased = function(str) {return caseInsensitive ? str.toLowerCase() : str;};
        var substr = this.string.substr(this.pos, pattern.length);
        if (cased(substr) == cased(pattern)) {
          if (consume !== false) this.pos += pattern.length;
          return true;
        }
      } else {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && match.index > 0) return null;
        if (match && consume !== false) this.pos += match[0].length;
        return match;
      }
    },
    current: function(){return this.string.slice(this.start, this.pos);},
    hideFirstChars: function(n, inner) {
      this.lineStart += n;
      try { return inner(); }
      finally { this.lineStart -= n; }
    }
  };

  // TEXTMARKERS

  // Created with markText and setBookmark methods. A TextMarker is a
  // handle that can be used to clear or find a marked position in the
  // document. Line objects hold arrays (markedSpans) containing
  // {from, to, marker} object pointing to such marker objects, and
  // indicating that such a marker is present on that line. Multiple
  // lines may point to the same marker when it spans across lines.
  // The spans will have null for their from/to properties when the
  // marker continues beyond the start/end of the line. Markers have
  // links back to the lines they currently touch.

  var TextMarker = CodeMirror.TextMarker = function(doc, type) {
    this.lines = [];
    this.type = type;
    this.doc = doc;
  };
  eventMixin(TextMarker);

  // Clear the marker.
  TextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    var cm = this.doc.cm, withOp = cm && !cm.curOp;
    if (withOp) startOperation(cm);
    if (hasHandler(this, "clear")) {
      var found = this.find();
      if (found) signalLater(this, "clear", found.from, found.to);
    }
    var min = null, max = null;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (cm && !this.collapsed) regLineChange(cm, lineNo(line), "text");
      else if (cm) {
        if (span.to != null) max = lineNo(line);
        if (span.from != null) min = lineNo(line);
      }
      line.markedSpans = removeMarkedSpan(line.markedSpans, span);
      if (span.from == null && this.collapsed && !lineIsHidden(this.doc, line) && cm)
        updateLineHeight(line, textHeight(cm.display));
    }
    if (cm && this.collapsed && !cm.options.lineWrapping) for (var i = 0; i < this.lines.length; ++i) {
      var visual = visualLine(this.lines[i]), len = lineLength(visual);
      if (len > cm.display.maxLineLength) {
        cm.display.maxLine = visual;
        cm.display.maxLineLength = len;
        cm.display.maxLineChanged = true;
      }
    }

    if (min != null && cm && this.collapsed) regChange(cm, min, max + 1);
    this.lines.length = 0;
    this.explicitlyCleared = true;
    if (this.atomic && this.doc.cantEdit) {
      this.doc.cantEdit = false;
      if (cm) reCheckSelection(cm.doc);
    }
    if (cm) signalLater(cm, "markerCleared", cm, this);
    if (withOp) endOperation(cm);
    if (this.parent) this.parent.clear();
  };

  // Find the position of the marker in the document. Returns a {from,
  // to} object by default. Side can be passed to get a specific side
  // -- 0 (both), -1 (left), or 1 (right). When lineObj is true, the
  // Pos objects returned contain a line object, rather than a line
  // number (used to prevent looking up the same line twice).
  TextMarker.prototype.find = function(side, lineObj) {
    if (side == null && this.type == "bookmark") side = 1;
    var from, to;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (span.from != null) {
        from = Pos(lineObj ? line : lineNo(line), span.from);
        if (side == -1) return from;
      }
      if (span.to != null) {
        to = Pos(lineObj ? line : lineNo(line), span.to);
        if (side == 1) return to;
      }
    }
    return from && {from: from, to: to};
  };

  // Signals that the marker's widget changed, and surrounding layout
  // should be recomputed.
  TextMarker.prototype.changed = function() {
    var pos = this.find(-1, true), widget = this, cm = this.doc.cm;
    if (!pos || !cm) return;
    runInOp(cm, function() {
      var line = pos.line, lineN = lineNo(pos.line);
      var view = findViewForLine(cm, lineN);
      if (view) {
        clearLineMeasurementCacheFor(view);
        cm.curOp.selectionChanged = cm.curOp.forceUpdate = true;
      }
      cm.curOp.updateMaxLine = true;
      if (!lineIsHidden(widget.doc, line) && widget.height != null) {
        var oldHeight = widget.height;
        widget.height = null;
        var dHeight = widgetHeight(widget) - oldHeight;
        if (dHeight)
          updateLineHeight(line, line.height + dHeight);
      }
    });
  };

  TextMarker.prototype.attachLine = function(line) {
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
        (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
    }
    this.lines.push(line);
  };
  TextMarker.prototype.detachLine = function(line) {
    this.lines.splice(indexOf(this.lines, line), 1);
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
    }
  };

  // Collapsed markers have unique ids, in order to be able to order
  // them, which is needed for uniquely determining an outer marker
  // when they overlap (they may nest, but not partially overlap).
  var nextMarkerId = 0;

  // Create a marker, wire it up to the right lines, and
  function markText(doc, from, to, options, type) {
    // Shared markers (across linked documents) are handled separately
    // (markTextShared will call out to this again, once per
    // document).
    if (options && options.shared) return markTextShared(doc, from, to, options, type);
    // Ensure we are in an operation.
    if (doc.cm && !doc.cm.curOp) return operation(doc.cm, markText)(doc, from, to, options, type);

    var marker = new TextMarker(doc, type), diff = cmp(from, to);
    if (options) copyObj(options, marker, false);
    // Don't connect empty markers unless clearWhenEmpty is false
    if (diff > 0 || diff == 0 && marker.clearWhenEmpty !== false)
      return marker;
    if (marker.replacedWith) {
      // Showing up as a widget implies collapsed (widget replaces text)
      marker.collapsed = true;
      marker.widgetNode = elt("span", [marker.replacedWith], "CodeMirror-widget");
      if (!options.handleMouseEvents) marker.widgetNode.setAttribute("cm-ignore-events", "true");
      if (options.insertLeft) marker.widgetNode.insertLeft = true;
    }
    if (marker.collapsed) {
      if (conflictingCollapsedRange(doc, from.line, from, to, marker) ||
          from.line != to.line && conflictingCollapsedRange(doc, to.line, from, to, marker))
        throw new Error("Inserting collapsed marker partially overlapping an existing one");
      sawCollapsedSpans = true;
    }

    if (marker.addToHistory)
      addChangeToHistory(doc, {from: from, to: to, origin: "markText"}, doc.sel, NaN);

    var curLine = from.line, cm = doc.cm, updateMaxLine;
    doc.iter(curLine, to.line + 1, function(line) {
      if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(line) == cm.display.maxLine)
        updateMaxLine = true;
      if (marker.collapsed && curLine != from.line) updateLineHeight(line, 0);
      addMarkedSpan(line, new MarkedSpan(marker,
                                         curLine == from.line ? from.ch : null,
                                         curLine == to.line ? to.ch : null));
      ++curLine;
    });
    // lineIsHidden depends on the presence of the spans, so needs a second pass
    if (marker.collapsed) doc.iter(from.line, to.line + 1, function(line) {
      if (lineIsHidden(doc, line)) updateLineHeight(line, 0);
    });

    if (marker.clearOnEnter) on(marker, "beforeCursorEnter", function() { marker.clear(); });

    if (marker.readOnly) {
      sawReadOnlySpans = true;
      if (doc.history.done.length || doc.history.undone.length)
        doc.clearHistory();
    }
    if (marker.collapsed) {
      marker.id = ++nextMarkerId;
      marker.atomic = true;
    }
    if (cm) {
      // Sync editor state
      if (updateMaxLine) cm.curOp.updateMaxLine = true;
      if (marker.collapsed)
        regChange(cm, from.line, to.line + 1);
      else if (marker.className || marker.title || marker.startStyle || marker.endStyle || marker.css)
        for (var i = from.line; i <= to.line; i++) regLineChange(cm, i, "text");
      if (marker.atomic) reCheckSelection(cm.doc);
      signalLater(cm, "markerAdded", cm, marker);
    }
    return marker;
  }

  // SHARED TEXTMARKERS

  // A shared marker spans multiple linked documents. It is
  // implemented as a meta-marker-object controlling multiple normal
  // markers.
  var SharedTextMarker = CodeMirror.SharedTextMarker = function(markers, primary) {
    this.markers = markers;
    this.primary = primary;
    for (var i = 0; i < markers.length; ++i)
      markers[i].parent = this;
  };
  eventMixin(SharedTextMarker);

  SharedTextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    this.explicitlyCleared = true;
    for (var i = 0; i < this.markers.length; ++i)
      this.markers[i].clear();
    signalLater(this, "clear");
  };
  SharedTextMarker.prototype.find = function(side, lineObj) {
    return this.primary.find(side, lineObj);
  };

  function markTextShared(doc, from, to, options, type) {
    options = copyObj(options);
    options.shared = false;
    var markers = [markText(doc, from, to, options, type)], primary = markers[0];
    var widget = options.widgetNode;
    linkedDocs(doc, function(doc) {
      if (widget) options.widgetNode = widget.cloneNode(true);
      markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
      for (var i = 0; i < doc.linked.length; ++i)
        if (doc.linked[i].isParent) return;
      primary = lst(markers);
    });
    return new SharedTextMarker(markers, primary);
  }

  function findSharedMarkers(doc) {
    return doc.findMarks(Pos(doc.first, 0), doc.clipPos(Pos(doc.lastLine())),
                         function(m) { return m.parent; });
  }

  function copySharedMarkers(doc, markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], pos = marker.find();
      var mFrom = doc.clipPos(pos.from), mTo = doc.clipPos(pos.to);
      if (cmp(mFrom, mTo)) {
        var subMark = markText(doc, mFrom, mTo, marker.primary, marker.primary.type);
        marker.markers.push(subMark);
        subMark.parent = marker;
      }
    }
  }

  function detachSharedMarkers(markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], linked = [marker.primary.doc];;
      linkedDocs(marker.primary.doc, function(d) { linked.push(d); });
      for (var j = 0; j < marker.markers.length; j++) {
        var subMarker = marker.markers[j];
        if (indexOf(linked, subMarker.doc) == -1) {
          subMarker.parent = null;
          marker.markers.splice(j--, 1);
        }
      }
    }
  }

  // TEXTMARKER SPANS

  function MarkedSpan(marker, from, to) {
    this.marker = marker;
    this.from = from; this.to = to;
  }

  // Search an array of spans for a span matching the given marker.
  function getMarkedSpanFor(spans, marker) {
    if (spans) for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.marker == marker) return span;
    }
  }
  // Remove a span from an array, returning undefined if no spans are
  // left (we don't store arrays for lines without spans).
  function removeMarkedSpan(spans, span) {
    for (var r, i = 0; i < spans.length; ++i)
      if (spans[i] != span) (r || (r = [])).push(spans[i]);
    return r;
  }
  // Add a span to a line.
  function addMarkedSpan(line, span) {
    line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
    span.marker.attachLine(line);
  }

  // Used for the algorithm that adjusts markers for a change in the
  // document. These functions cut an array of spans at a given
  // character position, returning an array of remaining chunks (or
  // undefined if nothing remains).
  function markedSpansBefore(old, startCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
      if (startsBefore || span.from == startCh && marker.type == "bookmark" && (!isInsert || !span.marker.insertLeft)) {
        var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, span.from, endsAfter ? null : span.to));
      }
    }
    return nw;
  }
  function markedSpansAfter(old, endCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
      if (endsAfter || span.from == endCh && marker.type == "bookmark" && (!isInsert || span.marker.insertLeft)) {
        var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, startsBefore ? null : span.from - endCh,
                                              span.to == null ? null : span.to - endCh));
      }
    }
    return nw;
  }

  // Given a change object, compute the new set of marker spans that
  // cover the line in which the change took place. Removes spans
  // entirely within the change, reconnects spans belonging to the
  // same marker that appear on both sides of the change, and cuts off
  // spans partially within the change. Returns an array of span
  // arrays with one element for each line in (after) the change.
  function stretchSpansOverChange(doc, change) {
    if (change.full) return null;
    var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
    var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
    if (!oldFirst && !oldLast) return null;

    var startCh = change.from.ch, endCh = change.to.ch, isInsert = cmp(change.from, change.to) == 0;
    // Get the spans that 'stick out' on both sides
    var first = markedSpansBefore(oldFirst, startCh, isInsert);
    var last = markedSpansAfter(oldLast, endCh, isInsert);

    // Next, merge those two ends
    var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
    if (first) {
      // Fix up .to properties of first
      for (var i = 0; i < first.length; ++i) {
        var span = first[i];
        if (span.to == null) {
          var found = getMarkedSpanFor(last, span.marker);
          if (!found) span.to = startCh;
          else if (sameLine) span.to = found.to == null ? null : found.to + offset;
        }
      }
    }
    if (last) {
      // Fix up .from in last (or move them into first in case of sameLine)
      for (var i = 0; i < last.length; ++i) {
        var span = last[i];
        if (span.to != null) span.to += offset;
        if (span.from == null) {
          var found = getMarkedSpanFor(first, span.marker);
          if (!found) {
            span.from = offset;
            if (sameLine) (first || (first = [])).push(span);
          }
        } else {
          span.from += offset;
          if (sameLine) (first || (first = [])).push(span);
        }
      }
    }
    // Make sure we didn't create any zero-length spans
    if (first) first = clearEmptySpans(first);
    if (last && last != first) last = clearEmptySpans(last);

    var newMarkers = [first];
    if (!sameLine) {
      // Fill gap with whole-line-spans
      var gap = change.text.length - 2, gapMarkers;
      if (gap > 0 && first)
        for (var i = 0; i < first.length; ++i)
          if (first[i].to == null)
            (gapMarkers || (gapMarkers = [])).push(new MarkedSpan(first[i].marker, null, null));
      for (var i = 0; i < gap; ++i)
        newMarkers.push(gapMarkers);
      newMarkers.push(last);
    }
    return newMarkers;
  }

  // Remove spans that are empty and don't have a clearWhenEmpty
  // option of false.
  function clearEmptySpans(spans) {
    for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.from != null && span.from == span.to && span.marker.clearWhenEmpty !== false)
        spans.splice(i--, 1);
    }
    if (!spans.length) return null;
    return spans;
  }

  // Used for un/re-doing changes from the history. Combines the
  // result of computing the existing spans with the set of spans that
  // existed in the history (so that deleting around a span and then
  // undoing brings back the span).
  function mergeOldSpans(doc, change) {
    var old = getOldSpans(doc, change);
    var stretched = stretchSpansOverChange(doc, change);
    if (!old) return stretched;
    if (!stretched) return old;

    for (var i = 0; i < old.length; ++i) {
      var oldCur = old[i], stretchCur = stretched[i];
      if (oldCur && stretchCur) {
        spans: for (var j = 0; j < stretchCur.length; ++j) {
          var span = stretchCur[j];
          for (var k = 0; k < oldCur.length; ++k)
            if (oldCur[k].marker == span.marker) continue spans;
          oldCur.push(span);
        }
      } else if (stretchCur) {
        old[i] = stretchCur;
      }
    }
    return old;
  }

  // Used to 'clip' out readOnly ranges when making a change.
  function removeReadOnlyRanges(doc, from, to) {
    var markers = null;
    doc.iter(from.line, to.line + 1, function(line) {
      if (line.markedSpans) for (var i = 0; i < line.markedSpans.length; ++i) {
        var mark = line.markedSpans[i].marker;
        if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
          (markers || (markers = [])).push(mark);
      }
    });
    if (!markers) return null;
    var parts = [{from: from, to: to}];
    for (var i = 0; i < markers.length; ++i) {
      var mk = markers[i], m = mk.find(0);
      for (var j = 0; j < parts.length; ++j) {
        var p = parts[j];
        if (cmp(p.to, m.from) < 0 || cmp(p.from, m.to) > 0) continue;
        var newParts = [j, 1], dfrom = cmp(p.from, m.from), dto = cmp(p.to, m.to);
        if (dfrom < 0 || !mk.inclusiveLeft && !dfrom)
          newParts.push({from: p.from, to: m.from});
        if (dto > 0 || !mk.inclusiveRight && !dto)
          newParts.push({from: m.to, to: p.to});
        parts.splice.apply(parts, newParts);
        j += newParts.length - 1;
      }
    }
    return parts;
  }

  // Connect or disconnect spans from a line.
  function detachMarkedSpans(line) {
    var spans = line.markedSpans;
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.detachLine(line);
    line.markedSpans = null;
  }
  function attachMarkedSpans(line, spans) {
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.attachLine(line);
    line.markedSpans = spans;
  }

  // Helpers used when computing which overlapping collapsed span
  // counts as the larger one.
  function extraLeft(marker) { return marker.inclusiveLeft ? -1 : 0; }
  function extraRight(marker) { return marker.inclusiveRight ? 1 : 0; }

  // Returns a number indicating which of two overlapping collapsed
  // spans is larger (and thus includes the other). Falls back to
  // comparing ids when the spans cover exactly the same range.
  function compareCollapsedMarkers(a, b) {
    var lenDiff = a.lines.length - b.lines.length;
    if (lenDiff != 0) return lenDiff;
    var aPos = a.find(), bPos = b.find();
    var fromCmp = cmp(aPos.from, bPos.from) || extraLeft(a) - extraLeft(b);
    if (fromCmp) return -fromCmp;
    var toCmp = cmp(aPos.to, bPos.to) || extraRight(a) - extraRight(b);
    if (toCmp) return toCmp;
    return b.id - a.id;
  }

  // Find out whether a line ends or starts in a collapsed span. If
  // so, return the marker for that span.
  function collapsedSpanAtSide(line, start) {
    var sps = sawCollapsedSpans && line.markedSpans, found;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (sp.marker.collapsed && (start ? sp.from : sp.to) == null &&
          (!found || compareCollapsedMarkers(found, sp.marker) < 0))
        found = sp.marker;
    }
    return found;
  }
  function collapsedSpanAtStart(line) { return collapsedSpanAtSide(line, true); }
  function collapsedSpanAtEnd(line) { return collapsedSpanAtSide(line, false); }

  // Test whether there exists a collapsed span that partially
  // overlaps (covers the start or end, but not both) of a new span.
  // Such overlap is not allowed.
  function conflictingCollapsedRange(doc, lineNo, from, to, marker) {
    var line = getLine(doc, lineNo);
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var i = 0; i < sps.length; ++i) {
      var sp = sps[i];
      if (!sp.marker.collapsed) continue;
      var found = sp.marker.find(0);
      var fromCmp = cmp(found.from, from) || extraLeft(sp.marker) - extraLeft(marker);
      var toCmp = cmp(found.to, to) || extraRight(sp.marker) - extraRight(marker);
      if (fromCmp >= 0 && toCmp <= 0 || fromCmp <= 0 && toCmp >= 0) continue;
      if (fromCmp <= 0 && (cmp(found.to, from) > 0 || (sp.marker.inclusiveRight && marker.inclusiveLeft)) ||
          fromCmp >= 0 && (cmp(found.from, to) < 0 || (sp.marker.inclusiveLeft && marker.inclusiveRight)))
        return true;
    }
  }

  // A visual line is a line as drawn on the screen. Folding, for
  // example, can cause multiple logical lines to appear on the same
  // visual line. This finds the start of the visual line that the
  // given line is part of (usually that is the line itself).
  function visualLine(line) {
    var merged;
    while (merged = collapsedSpanAtStart(line))
      line = merged.find(-1, true).line;
    return line;
  }

  // Returns an array of logical lines that continue the visual line
  // started by the argument, or undefined if there are no such lines.
  function visualLineContinued(line) {
    var merged, lines;
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      (lines || (lines = [])).push(line);
    }
    return lines;
  }

  // Get the line number of the start of the visual line that the
  // given line number is part of.
  function visualLineNo(doc, lineN) {
    var line = getLine(doc, lineN), vis = visualLine(line);
    if (line == vis) return lineN;
    return lineNo(vis);
  }
  // Get the line number of the start of the next visual line after
  // the given line.
  function visualLineEndNo(doc, lineN) {
    if (lineN > doc.lastLine()) return lineN;
    var line = getLine(doc, lineN), merged;
    if (!lineIsHidden(doc, line)) return lineN;
    while (merged = collapsedSpanAtEnd(line))
      line = merged.find(1, true).line;
    return lineNo(line) + 1;
  }

  // Compute whether a line is hidden. Lines count as hidden when they
  // are part of a visual line that starts with another line, or when
  // they are entirely covered by collapsed, non-widget span.
  function lineIsHidden(doc, line) {
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (!sp.marker.collapsed) continue;
      if (sp.from == null) return true;
      if (sp.marker.widgetNode) continue;
      if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
        return true;
    }
  }
  function lineIsHiddenInner(doc, line, span) {
    if (span.to == null) {
      var end = span.marker.find(1, true);
      return lineIsHiddenInner(doc, end.line, getMarkedSpanFor(end.line.markedSpans, span.marker));
    }
    if (span.marker.inclusiveRight && span.to == line.text.length)
      return true;
    for (var sp, i = 0; i < line.markedSpans.length; ++i) {
      sp = line.markedSpans[i];
      if (sp.marker.collapsed && !sp.marker.widgetNode && sp.from == span.to &&
          (sp.to == null || sp.to != span.from) &&
          (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
          lineIsHiddenInner(doc, line, sp)) return true;
    }
  }

  // LINE WIDGETS

  // Line widgets are block elements displayed above or below a line.

  var LineWidget = CodeMirror.LineWidget = function(cm, node, options) {
    if (options) for (var opt in options) if (options.hasOwnProperty(opt))
      this[opt] = options[opt];
    this.cm = cm;
    this.node = node;
  };
  eventMixin(LineWidget);

  function adjustScrollWhenAboveVisible(cm, line, diff) {
    if (heightAtLine(line) < ((cm.curOp && cm.curOp.scrollTop) || cm.doc.scrollTop))
      addToScrollPos(cm, null, diff);
  }

  LineWidget.prototype.clear = function() {
    var cm = this.cm, ws = this.line.widgets, line = this.line, no = lineNo(line);
    if (no == null || !ws) return;
    for (var i = 0; i < ws.length; ++i) if (ws[i] == this) ws.splice(i--, 1);
    if (!ws.length) line.widgets = null;
    var height = widgetHeight(this);
    runInOp(cm, function() {
      adjustScrollWhenAboveVisible(cm, line, -height);
      regLineChange(cm, no, "widget");
      updateLineHeight(line, Math.max(0, line.height - height));
    });
  };
  LineWidget.prototype.changed = function() {
    var oldH = this.height, cm = this.cm, line = this.line;
    this.height = null;
    var diff = widgetHeight(this) - oldH;
    if (!diff) return;
    runInOp(cm, function() {
      cm.curOp.forceUpdate = true;
      adjustScrollWhenAboveVisible(cm, line, diff);
      updateLineHeight(line, line.height + diff);
    });
  };

  function widgetHeight(widget) {
    if (widget.height != null) return widget.height;
    if (!contains(document.body, widget.node)) {
      var parentStyle = "position: relative;";
      if (widget.coverGutter)
        parentStyle += "margin-left: -" + widget.cm.display.gutters.offsetWidth + "px;";
      if (widget.noHScroll)
        parentStyle += "width: " + widget.cm.display.wrapper.clientWidth + "px;";
      removeChildrenAndAdd(widget.cm.display.measure, elt("div", [widget.node], null, parentStyle));
    }
    return widget.height = widget.node.offsetHeight;
  }

  function addLineWidget(cm, handle, node, options) {
    var widget = new LineWidget(cm, node, options);
    if (widget.noHScroll) cm.display.alignWidgets = true;
    changeLine(cm.doc, handle, "widget", function(line) {
      var widgets = line.widgets || (line.widgets = []);
      if (widget.insertAt == null) widgets.push(widget);
      else widgets.splice(Math.min(widgets.length - 1, Math.max(0, widget.insertAt)), 0, widget);
      widget.line = line;
      if (!lineIsHidden(cm.doc, line)) {
        var aboveVisible = heightAtLine(line) < cm.doc.scrollTop;
        updateLineHeight(line, line.height + widgetHeight(widget));
        if (aboveVisible) addToScrollPos(cm, null, widget.height);
        cm.curOp.forceUpdate = true;
      }
      return true;
    });
    return widget;
  }

  // LINE DATA STRUCTURE

  // Line objects. These hold state related to a line, including
  // highlighting info (the styles array).
  var Line = CodeMirror.Line = function(text, markedSpans, estimateHeight) {
    this.text = text;
    attachMarkedSpans(this, markedSpans);
    this.height = estimateHeight ? estimateHeight(this) : 1;
  };
  eventMixin(Line);
  Line.prototype.lineNo = function() { return lineNo(this); };

  // Change the content (text, markers) of a line. Automatically
  // invalidates cached information and tries to re-estimate the
  // line's height.
  function updateLine(line, text, markedSpans, estimateHeight) {
    line.text = text;
    if (line.stateAfter) line.stateAfter = null;
    if (line.styles) line.styles = null;
    if (line.order != null) line.order = null;
    detachMarkedSpans(line);
    attachMarkedSpans(line, markedSpans);
    var estHeight = estimateHeight ? estimateHeight(line) : 1;
    if (estHeight != line.height) updateLineHeight(line, estHeight);
  }

  // Detach a line from the document tree and its markers.
  function cleanUpLine(line) {
    line.parent = null;
    detachMarkedSpans(line);
  }

  function extractLineClasses(type, output) {
    if (type) for (;;) {
      var lineClass = type.match(/(?:^|\s+)line-(background-)?(\S+)/);
      if (!lineClass) break;
      type = type.slice(0, lineClass.index) + type.slice(lineClass.index + lineClass[0].length);
      var prop = lineClass[1] ? "bgClass" : "textClass";
      if (output[prop] == null)
        output[prop] = lineClass[2];
      else if (!(new RegExp("(?:^|\s)" + lineClass[2] + "(?:$|\s)")).test(output[prop]))
        output[prop] += " " + lineClass[2];
    }
    return type;
  }

  function callBlankLine(mode, state) {
    if (mode.blankLine) return mode.blankLine(state);
    if (!mode.innerMode) return;
    var inner = CodeMirror.innerMode(mode, state);
    if (inner.mode.blankLine) return inner.mode.blankLine(inner.state);
  }

  function readToken(mode, stream, state, inner) {
    for (var i = 0; i < 10; i++) {
      if (inner) inner[0] = CodeMirror.innerMode(mode, state).mode;
      var style = mode.token(stream, state);
      if (stream.pos > stream.start) return style;
    }
    throw new Error("Mode " + mode.name + " failed to advance stream.");
  }

  // Utility for getTokenAt and getLineTokens
  function takeToken(cm, pos, precise, asArray) {
    function getObj(copy) {
      return {start: stream.start, end: stream.pos,
              string: stream.current(),
              type: style || null,
              state: copy ? copyState(doc.mode, state) : state};
    }

    var doc = cm.doc, mode = doc.mode, style;
    pos = clipPos(doc, pos);
    var line = getLine(doc, pos.line), state = getStateBefore(cm, pos.line, precise);
    var stream = new StringStream(line.text, cm.options.tabSize), tokens;
    if (asArray) tokens = [];
    while ((asArray || stream.pos < pos.ch) && !stream.eol()) {
      stream.start = stream.pos;
      style = readToken(mode, stream, state);
      if (asArray) tokens.push(getObj(true));
    }
    return asArray ? tokens : getObj();
  }

  // Run the given mode's parser over a line, calling f for each token.
  function runMode(cm, text, mode, state, f, lineClasses, forceToEnd) {
    var flattenSpans = mode.flattenSpans;
    if (flattenSpans == null) flattenSpans = cm.options.flattenSpans;
    var curStart = 0, curStyle = null;
    var stream = new StringStream(text, cm.options.tabSize), style;
    var inner = cm.options.addModeClass && [null];
    if (text == "") extractLineClasses(callBlankLine(mode, state), lineClasses);
    while (!stream.eol()) {
      if (stream.pos > cm.options.maxHighlightLength) {
        flattenSpans = false;
        if (forceToEnd) processLine(cm, text, state, stream.pos);
        stream.pos = text.length;
        style = null;
      } else {
        style = extractLineClasses(readToken(mode, stream, state, inner), lineClasses);
      }
      if (inner) {
        var mName = inner[0].name;
        if (mName) style = "m-" + (style ? mName + " " + style : mName);
      }
      if (!flattenSpans || curStyle != style) {
        while (curStart < stream.start) {
          curStart = Math.min(stream.start, curStart + 50000);
          f(curStart, curStyle);
        }
        curStyle = style;
      }
      stream.start = stream.pos;
    }
    while (curStart < stream.pos) {
      // Webkit seems to refuse to render text nodes longer than 57444 characters
      var pos = Math.min(stream.pos, curStart + 50000);
      f(pos, curStyle);
      curStart = pos;
    }
  }

  // Compute a style array (an array starting with a mode generation
  // -- for invalidation -- followed by pairs of end positions and
  // style strings), which is used to highlight the tokens on the
  // line.
  function highlightLine(cm, line, state, forceToEnd) {
    // A styles array always starts with a number identifying the
    // mode/overlays that it is based on (for easy invalidation).
    var st = [cm.state.modeGen], lineClasses = {};
    // Compute the base array of styles
    runMode(cm, line.text, cm.doc.mode, state, function(end, style) {
      st.push(end, style);
    }, lineClasses, forceToEnd);

    // Run overlays, adjust style array.
    for (var o = 0; o < cm.state.overlays.length; ++o) {
      var overlay = cm.state.overlays[o], i = 1, at = 0;
      runMode(cm, line.text, overlay.mode, true, function(end, style) {
        var start = i;
        // Ensure there's a token end at the current position, and that i points at it
        while (at < end) {
          var i_end = st[i];
          if (i_end > end)
            st.splice(i, 1, end, st[i+1], i_end);
          i += 2;
          at = Math.min(end, i_end);
        }
        if (!style) return;
        if (overlay.opaque) {
          st.splice(start, i - start, end, "cm-overlay " + style);
          i = start + 2;
        } else {
          for (; start < i; start += 2) {
            var cur = st[start+1];
            st[start+1] = (cur ? cur + " " : "") + "cm-overlay " + style;
          }
        }
      }, lineClasses);
    }

    return {styles: st, classes: lineClasses.bgClass || lineClasses.textClass ? lineClasses : null};
  }

  function getLineStyles(cm, line, updateFrontier) {
    if (!line.styles || line.styles[0] != cm.state.modeGen) {
      var result = highlightLine(cm, line, line.stateAfter = getStateBefore(cm, lineNo(line)));
      line.styles = result.styles;
      if (result.classes) line.styleClasses = result.classes;
      else if (line.styleClasses) line.styleClasses = null;
      if (updateFrontier === cm.doc.frontier) cm.doc.frontier++;
    }
    return line.styles;
  }

  // Lightweight form of highlight -- proceed over this line and
  // update state, but don't save a style array. Used for lines that
  // aren't currently visible.
  function processLine(cm, text, state, startAt) {
    var mode = cm.doc.mode;
    var stream = new StringStream(text, cm.options.tabSize);
    stream.start = stream.pos = startAt || 0;
    if (text == "") callBlankLine(mode, state);
    while (!stream.eol() && stream.pos <= cm.options.maxHighlightLength) {
      readToken(mode, stream, state);
      stream.start = stream.pos;
    }
  }

  // Convert a style as returned by a mode (either null, or a string
  // containing one or more styles) to a CSS style. This is cached,
  // and also looks for line-wide styles.
  var styleToClassCache = {}, styleToClassCacheWithMode = {};
  function interpretTokenStyle(style, options) {
    if (!style || /^\s*$/.test(style)) return null;
    var cache = options.addModeClass ? styleToClassCacheWithMode : styleToClassCache;
    return cache[style] ||
      (cache[style] = style.replace(/\S+/g, "cm-$&"));
  }

  // Render the DOM representation of the text of a line. Also builds
  // up a 'line map', which points at the DOM nodes that represent
  // specific stretches of text, and is used by the measuring code.
  // The returned object contains the DOM node, this map, and
  // information about line-wide styles that were set by the mode.
  function buildLineContent(cm, lineView) {
    // The padding-right forces the element to have a 'border', which
    // is needed on Webkit to be able to get line-level bounding
    // rectangles for it (in measureChar).
    var content = elt("span", null, null, webkit ? "padding-right: .1px" : null);
    var builder = {pre: elt("pre", [content]), content: content, col: 0, pos: 0, cm: cm};
    lineView.measure = {};

    // Iterate over the logical lines that make up this visual line.
    for (var i = 0; i <= (lineView.rest ? lineView.rest.length : 0); i++) {
      var line = i ? lineView.rest[i - 1] : lineView.line, order;
      builder.pos = 0;
      builder.addToken = buildToken;
      // Optionally wire in some hacks into the token-rendering
      // algorithm, to deal with browser quirks.
      if ((ie || webkit) && cm.getOption("lineWrapping"))
        builder.addToken = buildTokenSplitSpaces(builder.addToken);
      if (hasBadBidiRects(cm.display.measure) && (order = getOrder(line)))
        builder.addToken = buildTokenBadBidi(builder.addToken, order);
      builder.map = [];
      var allowFrontierUpdate = lineView != cm.display.externalMeasured && lineNo(line);
      insertLineContent(line, builder, getLineStyles(cm, line, allowFrontierUpdate));
      if (line.styleClasses) {
        if (line.styleClasses.bgClass)
          builder.bgClass = joinClasses(line.styleClasses.bgClass, builder.bgClass || "");
        if (line.styleClasses.textClass)
          builder.textClass = joinClasses(line.styleClasses.textClass, builder.textClass || "");
      }

      // Ensure at least a single node is present, for measuring.
      if (builder.map.length == 0)
        builder.map.push(0, 0, builder.content.appendChild(zeroWidthElement(cm.display.measure)));

      // Store the map and a cache object for the current logical line
      if (i == 0) {
        lineView.measure.map = builder.map;
        lineView.measure.cache = {};
      } else {
        (lineView.measure.maps || (lineView.measure.maps = [])).push(builder.map);
        (lineView.measure.caches || (lineView.measure.caches = [])).push({});
      }
    }

    // See issue #2901
    if (webkit && /\bcm-tab\b/.test(builder.content.lastChild.className))
      builder.content.className = "cm-tab-wrap-hack";

    signal(cm, "renderLine", cm, lineView.line, builder.pre);
    if (builder.pre.className)
      builder.textClass = joinClasses(builder.pre.className, builder.textClass || "");

    return builder;
  }

  function defaultSpecialCharPlaceholder(ch) {
    var token = elt("span", "\u2022", "cm-invalidchar");
    token.title = "\\u" + ch.charCodeAt(0).toString(16);
    return token;
  }

  // Build up the DOM representation for a single token, and add it to
  // the line map. Takes care to render special characters separately.
  function buildToken(builder, text, style, startStyle, endStyle, title, css) {
    if (!text) return;
    var special = builder.cm.options.specialChars, mustWrap = false;
    if (!special.test(text)) {
      builder.col += text.length;
      var content = document.createTextNode(text);
      builder.map.push(builder.pos, builder.pos + text.length, content);
      if (ie && ie_version < 9) mustWrap = true;
      builder.pos += text.length;
    } else {
      var content = document.createDocumentFragment(), pos = 0;
      while (true) {
        special.lastIndex = pos;
        var m = special.exec(text);
        var skipped = m ? m.index - pos : text.length - pos;
        if (skipped) {
          var txt = document.createTextNode(text.slice(pos, pos + skipped));
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.map.push(builder.pos, builder.pos + skipped, txt);
          builder.col += skipped;
          builder.pos += skipped;
        }
        if (!m) break;
        pos += skipped + 1;
        if (m[0] == "\t") {
          var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
          var txt = content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
          builder.col += tabWidth;
        } else {
          var txt = builder.cm.options.specialCharPlaceholder(m[0]);
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.col += 1;
        }
        builder.map.push(builder.pos, builder.pos + 1, txt);
        builder.pos++;
      }
    }
    if (style || startStyle || endStyle || mustWrap || css) {
      var fullStyle = style || "";
      if (startStyle) fullStyle += startStyle;
      if (endStyle) fullStyle += endStyle;
      var token = elt("span", [content], fullStyle, css);
      if (title) token.title = title;
      return builder.content.appendChild(token);
    }
    builder.content.appendChild(content);
  }

  function buildTokenSplitSpaces(inner) {
    function split(old) {
      var out = " ";
      for (var i = 0; i < old.length - 2; ++i) out += i % 2 ? " " : "\u00a0";
      out += " ";
      return out;
    }
    return function(builder, text, style, startStyle, endStyle, title) {
      inner(builder, text.replace(/ {3,}/g, split), style, startStyle, endStyle, title);
    };
  }

  // Work around nonsense dimensions being reported for stretches of
  // right-to-left text.
  function buildTokenBadBidi(inner, order) {
    return function(builder, text, style, startStyle, endStyle, title) {
      style = style ? style + " cm-force-border" : "cm-force-border";
      var start = builder.pos, end = start + text.length;
      for (;;) {
        // Find the part that overlaps with the start of this text
        for (var i = 0; i < order.length; i++) {
          var part = order[i];
          if (part.to > start && part.from <= start) break;
        }
        if (part.to >= end) return inner(builder, text, style, startStyle, endStyle, title);
        inner(builder, text.slice(0, part.to - start), style, startStyle, null, title);
        startStyle = null;
        text = text.slice(part.to - start);
        start = part.to;
      }
    };
  }

  function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
    var widget = !ignoreWidget && marker.widgetNode;
    if (widget) {
      builder.map.push(builder.pos, builder.pos + size, widget);
      builder.content.appendChild(widget);
    }
    builder.pos += size;
  }

  // Outputs a number of spans to make up a line, taking highlighting
  // and marked text into account.
  function insertLineContent(line, builder, styles) {
    var spans = line.markedSpans, allText = line.text, at = 0;
    if (!spans) {
      for (var i = 1; i < styles.length; i+=2)
        builder.addToken(builder, allText.slice(at, at = styles[i]), interpretTokenStyle(styles[i+1], builder.cm.options));
      return;
    }

    var len = allText.length, pos = 0, i = 1, text = "", style, css;
    var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, title, collapsed;
    for (;;) {
      if (nextChange == pos) { // Update current marker set
        spanStyle = spanEndStyle = spanStartStyle = title = css = "";
        collapsed = null; nextChange = Infinity;
        var foundBookmarks = [];
        for (var j = 0; j < spans.length; ++j) {
          var sp = spans[j], m = sp.marker;
          if (sp.from <= pos && (sp.to == null || sp.to > pos)) {
            if (sp.to != null && nextChange > sp.to) { nextChange = sp.to; spanEndStyle = ""; }
            if (m.className) spanStyle += " " + m.className;
            if (m.css) css = m.css;
            if (m.startStyle && sp.from == pos) spanStartStyle += " " + m.startStyle;
            if (m.endStyle && sp.to == nextChange) spanEndStyle += " " + m.endStyle;
            if (m.title && !title) title = m.title;
            if (m.collapsed && (!collapsed || compareCollapsedMarkers(collapsed.marker, m) < 0))
              collapsed = sp;
          } else if (sp.from > pos && nextChange > sp.from) {
            nextChange = sp.from;
          }
          if (m.type == "bookmark" && sp.from == pos && m.widgetNode) foundBookmarks.push(m);
        }
        if (collapsed && (collapsed.from || 0) == pos) {
          buildCollapsedSpan(builder, (collapsed.to == null ? len + 1 : collapsed.to) - pos,
                             collapsed.marker, collapsed.from == null);
          if (collapsed.to == null) return;
        }
        if (!collapsed && foundBookmarks.length) for (var j = 0; j < foundBookmarks.length; ++j)
          buildCollapsedSpan(builder, 0, foundBookmarks[j]);
      }
      if (pos >= len) break;

      var upto = Math.min(len, nextChange);
      while (true) {
        if (text) {
          var end = pos + text.length;
          if (!collapsed) {
            var tokenText = end > upto ? text.slice(0, upto - pos) : text;
            builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                             spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", title, css);
          }
          if (end >= upto) {text = text.slice(upto - pos); pos = upto; break;}
          pos = end;
          spanStartStyle = "";
        }
        text = allText.slice(at, at = styles[i++]);
        style = interpretTokenStyle(styles[i++], builder.cm.options);
      }
    }
  }

  // DOCUMENT DATA STRUCTURE

  // By default, updates that start and end at the beginning of a line
  // are treated specially, in order to make the association of line
  // widgets and marker elements with the text behave more intuitive.
  function isWholeLineUpdate(doc, change) {
    return change.from.ch == 0 && change.to.ch == 0 && lst(change.text) == "" &&
      (!doc.cm || doc.cm.options.wholeLineUpdateBefore);
  }

  // Perform a change on the document data structure.
  function updateDoc(doc, change, markedSpans, estimateHeight) {
    function spansFor(n) {return markedSpans ? markedSpans[n] : null;}
    function update(line, text, spans) {
      updateLine(line, text, spans, estimateHeight);
      signalLater(line, "change", line, change);
    }
    function linesFor(start, end) {
      for (var i = start, result = []; i < end; ++i)
        result.push(new Line(text[i], spansFor(i), estimateHeight));
      return result;
    }

    var from = change.from, to = change.to, text = change.text;
    var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
    var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

    // Adjust the line structure
    if (change.full) {
      doc.insert(0, linesFor(0, text.length));
      doc.remove(text.length, doc.size - text.length);
    } else if (isWholeLineUpdate(doc, change)) {
      // This is a whole-line replace. Treated specially to make
      // sure line objects move the way they are supposed to.
      var added = linesFor(0, text.length - 1);
      update(lastLine, lastLine.text, lastSpans);
      if (nlines) doc.remove(from.line, nlines);
      if (added.length) doc.insert(from.line, added);
    } else if (firstLine == lastLine) {
      if (text.length == 1) {
        update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
      } else {
        var added = linesFor(1, text.length - 1);
        added.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
        update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
        doc.insert(from.line + 1, added);
      }
    } else if (text.length == 1) {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
      doc.remove(from.line + 1, nlines);
    } else {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
      update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
      var added = linesFor(1, text.length - 1);
      if (nlines > 1) doc.remove(from.line + 1, nlines - 1);
      doc.insert(from.line + 1, added);
    }

    signalLater(doc, "change", doc, change);
  }

  // The document is represented as a BTree consisting of leaves, with
  // chunk of lines in them, and branches, with up to ten leaves or
  // other branch nodes below them. The top node is always a branch
  // node, and is the document object itself (meaning it has
  // additional methods and properties).
  //
  // All nodes have parent links. The tree is used both to go from
  // line numbers to line objects, and to go from objects to numbers.
  // It also indexes by height, and is used to convert between height
  // and line object, and to find the total height of the document.
  //
  // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html

  function LeafChunk(lines) {
    this.lines = lines;
    this.parent = null;
    for (var i = 0, height = 0; i < lines.length; ++i) {
      lines[i].parent = this;
      height += lines[i].height;
    }
    this.height = height;
  }

  LeafChunk.prototype = {
    chunkSize: function() { return this.lines.length; },
    // Remove the n lines at offset 'at'.
    removeInner: function(at, n) {
      for (var i = at, e = at + n; i < e; ++i) {
        var line = this.lines[i];
        this.height -= line.height;
        cleanUpLine(line);
        signalLater(line, "delete");
      }
      this.lines.splice(at, n);
    },
    // Helper used to collapse a small branch into a single leaf.
    collapse: function(lines) {
      lines.push.apply(lines, this.lines);
    },
    // Insert the given array of lines at offset 'at', count them as
    // having the given height.
    insertInner: function(at, lines, height) {
      this.height += height;
      this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
      for (var i = 0; i < lines.length; ++i) lines[i].parent = this;
    },
    // Used to iterate over a part of the tree.
    iterN: function(at, n, op) {
      for (var e = at + n; at < e; ++at)
        if (op(this.lines[at])) return true;
    }
  };

  function BranchChunk(children) {
    this.children = children;
    var size = 0, height = 0;
    for (var i = 0; i < children.length; ++i) {
      var ch = children[i];
      size += ch.chunkSize(); height += ch.height;
      ch.parent = this;
    }
    this.size = size;
    this.height = height;
    this.parent = null;
  }

  BranchChunk.prototype = {
    chunkSize: function() { return this.size; },
    removeInner: function(at, n) {
      this.size -= n;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var rm = Math.min(n, sz - at), oldHeight = child.height;
          child.removeInner(at, rm);
          this.height -= oldHeight - child.height;
          if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
          if ((n -= rm) == 0) break;
          at = 0;
        } else at -= sz;
      }
      // If the result is smaller than 25 lines, ensure that it is a
      // single leaf node.
      if (this.size - n < 25 &&
          (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
        var lines = [];
        this.collapse(lines);
        this.children = [new LeafChunk(lines)];
        this.children[0].parent = this;
      }
    },
    collapse: function(lines) {
      for (var i = 0; i < this.children.length; ++i) this.children[i].collapse(lines);
    },
    insertInner: function(at, lines, height) {
      this.size += lines.length;
      this.height += height;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at <= sz) {
          child.insertInner(at, lines, height);
          if (child.lines && child.lines.length > 50) {
            while (child.lines.length > 50) {
              var spilled = child.lines.splice(child.lines.length - 25, 25);
              var newleaf = new LeafChunk(spilled);
              child.height -= newleaf.height;
              this.children.splice(i + 1, 0, newleaf);
              newleaf.parent = this;
            }
            this.maybeSpill();
          }
          break;
        }
        at -= sz;
      }
    },
    // When a node has grown, check whether it should be split.
    maybeSpill: function() {
      if (this.children.length <= 10) return;
      var me = this;
      do {
        var spilled = me.children.splice(me.children.length - 5, 5);
        var sibling = new BranchChunk(spilled);
        if (!me.parent) { // Become the parent node
          var copy = new BranchChunk(me.children);
          copy.parent = me;
          me.children = [copy, sibling];
          me = copy;
        } else {
          me.size -= sibling.size;
          me.height -= sibling.height;
          var myIndex = indexOf(me.parent.children, me);
          me.parent.children.splice(myIndex + 1, 0, sibling);
        }
        sibling.parent = me.parent;
      } while (me.children.length > 10);
      me.parent.maybeSpill();
    },
    iterN: function(at, n, op) {
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var used = Math.min(n, sz - at);
          if (child.iterN(at, used, op)) return true;
          if ((n -= used) == 0) break;
          at = 0;
        } else at -= sz;
      }
    }
  };

  var nextDocId = 0;
  var Doc = CodeMirror.Doc = function(text, mode, firstLine) {
    if (!(this instanceof Doc)) return new Doc(text, mode, firstLine);
    if (firstLine == null) firstLine = 0;

    BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
    this.first = firstLine;
    this.scrollTop = this.scrollLeft = 0;
    this.cantEdit = false;
    this.cleanGeneration = 1;
    this.frontier = firstLine;
    var start = Pos(firstLine, 0);
    this.sel = simpleSelection(start);
    this.history = new History(null);
    this.id = ++nextDocId;
    this.modeOption = mode;

    if (typeof text == "string") text = splitLines(text);
    updateDoc(this, {from: start, to: start, text: text});
    setSelection(this, simpleSelection(start), sel_dontScroll);
  };

  Doc.prototype = createObj(BranchChunk.prototype, {
    constructor: Doc,
    // Iterate over the document. Supports two forms -- with only one
    // argument, it calls that for each line in the document. With
    // three, it iterates over the range given by the first two (with
    // the second being non-inclusive).
    iter: function(from, to, op) {
      if (op) this.iterN(from - this.first, to - from, op);
      else this.iterN(this.first, this.first + this.size, from);
    },

    // Non-public interface for adding and removing lines.
    insert: function(at, lines) {
      var height = 0;
      for (var i = 0; i < lines.length; ++i) height += lines[i].height;
      this.insertInner(at - this.first, lines, height);
    },
    remove: function(at, n) { this.removeInner(at - this.first, n); },

    // From here, the methods are part of the public interface. Most
    // are also available from CodeMirror (editor) instances.

    getValue: function(lineSep) {
      var lines = getLines(this, this.first, this.first + this.size);
      if (lineSep === false) return lines;
      return lines.join(lineSep || "\n");
    },
    setValue: docMethodOp(function(code) {
      var top = Pos(this.first, 0), last = this.first + this.size - 1;
      makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                        text: splitLines(code), origin: "setValue", full: true}, true);
      setSelection(this, simpleSelection(top));
    }),
    replaceRange: function(code, from, to, origin) {
      from = clipPos(this, from);
      to = to ? clipPos(this, to) : from;
      replaceRange(this, code, from, to, origin);
    },
    getRange: function(from, to, lineSep) {
      var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
      if (lineSep === false) return lines;
      return lines.join(lineSep || "\n");
    },

    getLine: function(line) {var l = this.getLineHandle(line); return l && l.text;},

    getLineHandle: function(line) {if (isLine(this, line)) return getLine(this, line);},
    getLineNumber: function(line) {return lineNo(line);},

    getLineHandleVisualStart: function(line) {
      if (typeof line == "number") line = getLine(this, line);
      return visualLine(line);
    },

    lineCount: function() {return this.size;},
    firstLine: function() {return this.first;},
    lastLine: function() {return this.first + this.size - 1;},

    clipPos: function(pos) {return clipPos(this, pos);},

    getCursor: function(start) {
      var range = this.sel.primary(), pos;
      if (start == null || start == "head") pos = range.head;
      else if (start == "anchor") pos = range.anchor;
      else if (start == "end" || start == "to" || start === false) pos = range.to();
      else pos = range.from();
      return pos;
    },
    listSelections: function() { return this.sel.ranges; },
    somethingSelected: function() {return this.sel.somethingSelected();},

    setCursor: docMethodOp(function(line, ch, options) {
      setSimpleSelection(this, clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line), null, options);
    }),
    setSelection: docMethodOp(function(anchor, head, options) {
      setSimpleSelection(this, clipPos(this, anchor), clipPos(this, head || anchor), options);
    }),
    extendSelection: docMethodOp(function(head, other, options) {
      extendSelection(this, clipPos(this, head), other && clipPos(this, other), options);
    }),
    extendSelections: docMethodOp(function(heads, options) {
      extendSelections(this, clipPosArray(this, heads, options));
    }),
    extendSelectionsBy: docMethodOp(function(f, options) {
      extendSelections(this, map(this.sel.ranges, f), options);
    }),
    setSelections: docMethodOp(function(ranges, primary, options) {
      if (!ranges.length) return;
      for (var i = 0, out = []; i < ranges.length; i++)
        out[i] = new Range(clipPos(this, ranges[i].anchor),
                           clipPos(this, ranges[i].head));
      if (primary == null) primary = Math.min(ranges.length - 1, this.sel.primIndex);
      setSelection(this, normalizeSelection(out, primary), options);
    }),
    addSelection: docMethodOp(function(anchor, head, options) {
      var ranges = this.sel.ranges.slice(0);
      ranges.push(new Range(clipPos(this, anchor), clipPos(this, head || anchor)));
      setSelection(this, normalizeSelection(ranges, ranges.length - 1), options);
    }),

    getSelection: function(lineSep) {
      var ranges = this.sel.ranges, lines;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        lines = lines ? lines.concat(sel) : sel;
      }
      if (lineSep === false) return lines;
      else return lines.join(lineSep || "\n");
    },
    getSelections: function(lineSep) {
      var parts = [], ranges = this.sel.ranges;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        if (lineSep !== false) sel = sel.join(lineSep || "\n");
        parts[i] = sel;
      }
      return parts;
    },
    replaceSelection: function(code, collapse, origin) {
      var dup = [];
      for (var i = 0; i < this.sel.ranges.length; i++)
        dup[i] = code;
      this.replaceSelections(dup, collapse, origin || "+input");
    },
    replaceSelections: docMethodOp(function(code, collapse, origin) {
      var changes = [], sel = this.sel;
      for (var i = 0; i < sel.ranges.length; i++) {
        var range = sel.ranges[i];
        changes[i] = {from: range.from(), to: range.to(), text: splitLines(code[i]), origin: origin};
      }
      var newSel = collapse && collapse != "end" && computeReplacedSel(this, changes, collapse);
      for (var i = changes.length - 1; i >= 0; i--)
        makeChange(this, changes[i]);
      if (newSel) setSelectionReplaceHistory(this, newSel);
      else if (this.cm) ensureCursorVisible(this.cm);
    }),
    undo: docMethodOp(function() {makeChangeFromHistory(this, "undo");}),
    redo: docMethodOp(function() {makeChangeFromHistory(this, "redo");}),
    undoSelection: docMethodOp(function() {makeChangeFromHistory(this, "undo", true);}),
    redoSelection: docMethodOp(function() {makeChangeFromHistory(this, "redo", true);}),

    setExtending: function(val) {this.extend = val;},
    getExtending: function() {return this.extend;},

    historySize: function() {
      var hist = this.history, done = 0, undone = 0;
      for (var i = 0; i < hist.done.length; i++) if (!hist.done[i].ranges) ++done;
      for (var i = 0; i < hist.undone.length; i++) if (!hist.undone[i].ranges) ++undone;
      return {undo: done, redo: undone};
    },
    clearHistory: function() {this.history = new History(this.history.maxGeneration);},

    markClean: function() {
      this.cleanGeneration = this.changeGeneration(true);
    },
    changeGeneration: function(forceSplit) {
      if (forceSplit)
        this.history.lastOp = this.history.lastSelOp = this.history.lastOrigin = null;
      return this.history.generation;
    },
    isClean: function (gen) {
      return this.history.generation == (gen || this.cleanGeneration);
    },

    getHistory: function() {
      return {done: copyHistoryArray(this.history.done),
              undone: copyHistoryArray(this.history.undone)};
    },
    setHistory: function(histData) {
      var hist = this.history = new History(this.history.maxGeneration);
      hist.done = copyHistoryArray(histData.done.slice(0), null, true);
      hist.undone = copyHistoryArray(histData.undone.slice(0), null, true);
    },

    addLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        if (!line[prop]) line[prop] = cls;
        else if (classTest(cls).test(line[prop])) return false;
        else line[prop] += " " + cls;
        return true;
      });
    }),
    removeLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        var cur = line[prop];
        if (!cur) return false;
        else if (cls == null) line[prop] = null;
        else {
          var found = cur.match(classTest(cls));
          if (!found) return false;
          var end = found.index + found[0].length;
          line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
        }
        return true;
      });
    }),

    markText: function(from, to, options) {
      return markText(this, clipPos(this, from), clipPos(this, to), options, "range");
    },
    setBookmark: function(pos, options) {
      var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                      insertLeft: options && options.insertLeft,
                      clearWhenEmpty: false, shared: options && options.shared};
      pos = clipPos(this, pos);
      return markText(this, pos, pos, realOpts, "bookmark");
    },
    findMarksAt: function(pos) {
      pos = clipPos(this, pos);
      var markers = [], spans = getLine(this, pos.line).markedSpans;
      if (spans) for (var i = 0; i < spans.length; ++i) {
        var span = spans[i];
        if ((span.from == null || span.from <= pos.ch) &&
            (span.to == null || span.to >= pos.ch))
          markers.push(span.marker.parent || span.marker);
      }
      return markers;
    },
    findMarks: function(from, to, filter) {
      from = clipPos(this, from); to = clipPos(this, to);
      var found = [], lineNo = from.line;
      this.iter(from.line, to.line + 1, function(line) {
        var spans = line.markedSpans;
        if (spans) for (var i = 0; i < spans.length; i++) {
          var span = spans[i];
          if (!(lineNo == from.line && from.ch > span.to ||
                span.from == null && lineNo != from.line||
                lineNo == to.line && span.from > to.ch) &&
              (!filter || filter(span.marker)))
            found.push(span.marker.parent || span.marker);
        }
        ++lineNo;
      });
      return found;
    },
    getAllMarks: function() {
      var markers = [];
      this.iter(function(line) {
        var sps = line.markedSpans;
        if (sps) for (var i = 0; i < sps.length; ++i)
          if (sps[i].from != null) markers.push(sps[i].marker);
      });
      return markers;
    },

    posFromIndex: function(off) {
      var ch, lineNo = this.first;
      this.iter(function(line) {
        var sz = line.text.length + 1;
        if (sz > off) { ch = off; return true; }
        off -= sz;
        ++lineNo;
      });
      return clipPos(this, Pos(lineNo, ch));
    },
    indexFromPos: function (coords) {
      coords = clipPos(this, coords);
      var index = coords.ch;
      if (coords.line < this.first || coords.ch < 0) return 0;
      this.iter(this.first, coords.line, function (line) {
        index += line.text.length + 1;
      });
      return index;
    },

    copy: function(copyHistory) {
      var doc = new Doc(getLines(this, this.first, this.first + this.size), this.modeOption, this.first);
      doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
      doc.sel = this.sel;
      doc.extend = false;
      if (copyHistory) {
        doc.history.undoDepth = this.history.undoDepth;
        doc.setHistory(this.getHistory());
      }
      return doc;
    },

    linkedDoc: function(options) {
      if (!options) options = {};
      var from = this.first, to = this.first + this.size;
      if (options.from != null && options.from > from) from = options.from;
      if (options.to != null && options.to < to) to = options.to;
      var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from);
      if (options.sharedHist) copy.history = this.history;
      (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
      copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
      copySharedMarkers(copy, findSharedMarkers(this));
      return copy;
    },
    unlinkDoc: function(other) {
      if (other instanceof CodeMirror) other = other.doc;
      if (this.linked) for (var i = 0; i < this.linked.length; ++i) {
        var link = this.linked[i];
        if (link.doc != other) continue;
        this.linked.splice(i, 1);
        other.unlinkDoc(this);
        detachSharedMarkers(findSharedMarkers(this));
        break;
      }
      // If the histories were shared, split them again
      if (other.history == this.history) {
        var splitIds = [other.id];
        linkedDocs(other, function(doc) {splitIds.push(doc.id);}, true);
        other.history = new History(null);
        other.history.done = copyHistoryArray(this.history.done, splitIds);
        other.history.undone = copyHistoryArray(this.history.undone, splitIds);
      }
    },
    iterLinkedDocs: function(f) {linkedDocs(this, f);},

    getMode: function() {return this.mode;},
    getEditor: function() {return this.cm;}
  });

  // Public alias.
  Doc.prototype.eachLine = Doc.prototype.iter;

  // Set up methods on CodeMirror's prototype to redirect to the editor's document.
  var dontDelegate = "iter insert remove copy getEditor".split(" ");
  for (var prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
    CodeMirror.prototype[prop] = (function(method) {
      return function() {return method.apply(this.doc, arguments);};
    })(Doc.prototype[prop]);

  eventMixin(Doc);

  // Call f for all linked documents.
  function linkedDocs(doc, f, sharedHistOnly) {
    function propagate(doc, skip, sharedHist) {
      if (doc.linked) for (var i = 0; i < doc.linked.length; ++i) {
        var rel = doc.linked[i];
        if (rel.doc == skip) continue;
        var shared = sharedHist && rel.sharedHist;
        if (sharedHistOnly && !shared) continue;
        f(rel.doc, shared);
        propagate(rel.doc, doc, shared);
      }
    }
    propagate(doc, null, true);
  }

  // Attach a document to an editor.
  function attachDoc(cm, doc) {
    if (doc.cm) throw new Error("This document is already in use.");
    cm.doc = doc;
    doc.cm = cm;
    estimateLineHeights(cm);
    loadMode(cm);
    if (!cm.options.lineWrapping) findMaxLine(cm);
    cm.options.mode = doc.modeOption;
    regChange(cm);
  }

  // LINE UTILITIES

  // Find the line object corresponding to the given line number.
  function getLine(doc, n) {
    n -= doc.first;
    if (n < 0 || n >= doc.size) throw new Error("There is no line " + (n + doc.first) + " in the document.");
    for (var chunk = doc; !chunk.lines;) {
      for (var i = 0;; ++i) {
        var child = chunk.children[i], sz = child.chunkSize();
        if (n < sz) { chunk = child; break; }
        n -= sz;
      }
    }
    return chunk.lines[n];
  }

  // Get the part of a document between two positions, as an array of
  // strings.
  function getBetween(doc, start, end) {
    var out = [], n = start.line;
    doc.iter(start.line, end.line + 1, function(line) {
      var text = line.text;
      if (n == end.line) text = text.slice(0, end.ch);
      if (n == start.line) text = text.slice(start.ch);
      out.push(text);
      ++n;
    });
    return out;
  }
  // Get the lines between from and to, as array of strings.
  function getLines(doc, from, to) {
    var out = [];
    doc.iter(from, to, function(line) { out.push(line.text); });
    return out;
  }

  // Update the height of a line, propagating the height change
  // upwards to parent nodes.
  function updateLineHeight(line, height) {
    var diff = height - line.height;
    if (diff) for (var n = line; n; n = n.parent) n.height += diff;
  }

  // Given a line object, find its line number by walking up through
  // its parent links.
  function lineNo(line) {
    if (line.parent == null) return null;
    var cur = line.parent, no = indexOf(cur.lines, line);
    for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
      for (var i = 0;; ++i) {
        if (chunk.children[i] == cur) break;
        no += chunk.children[i].chunkSize();
      }
    }
    return no + cur.first;
  }

  // Find the line at the given vertical position, using the height
  // information in the document tree.
  function lineAtHeight(chunk, h) {
    var n = chunk.first;
    outer: do {
      for (var i = 0; i < chunk.children.length; ++i) {
        var child = chunk.children[i], ch = child.height;
        if (h < ch) { chunk = child; continue outer; }
        h -= ch;
        n += child.chunkSize();
      }
      return n;
    } while (!chunk.lines);
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i], lh = line.height;
      if (h < lh) break;
      h -= lh;
    }
    return n + i;
  }


  // Find the height above the given line.
  function heightAtLine(lineObj) {
    lineObj = visualLine(lineObj);

    var h = 0, chunk = lineObj.parent;
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i];
      if (line == lineObj) break;
      else h += line.height;
    }
    for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
      for (var i = 0; i < p.children.length; ++i) {
        var cur = p.children[i];
        if (cur == chunk) break;
        else h += cur.height;
      }
    }
    return h;
  }

  // Get the bidi ordering for the given line (and cache it). Returns
  // false for lines that are fully left-to-right, and an array of
  // BidiSpan objects otherwise.
  function getOrder(line) {
    var order = line.order;
    if (order == null) order = line.order = bidiOrdering(line.text);
    return order;
  }

  // HISTORY

  function History(startGen) {
    // Arrays of change events and selections. Doing something adds an
    // event to done and clears undo. Undoing moves events from done
    // to undone, redoing moves them in the other direction.
    this.done = []; this.undone = [];
    this.undoDepth = Infinity;
    // Used to track when changes can be merged into a single undo
    // event
    this.lastModTime = this.lastSelTime = 0;
    this.lastOp = this.lastSelOp = null;
    this.lastOrigin = this.lastSelOrigin = null;
    // Used by the isClean() method
    this.generation = this.maxGeneration = startGen || 1;
  }

  // Create a history change event from an updateDoc-style change
  // object.
  function historyChangeFromChange(doc, change) {
    var histChange = {from: copyPos(change.from), to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
    attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
    linkedDocs(doc, function(doc) {attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);}, true);
    return histChange;
  }

  // Pop all selection events off the end of a history array. Stop at
  // a change event.
  function clearSelectionEvents(array) {
    while (array.length) {
      var last = lst(array);
      if (last.ranges) array.pop();
      else break;
    }
  }

  // Find the top change event in the history. Pop off selection
  // events that are in the way.
  function lastChangeEvent(hist, force) {
    if (force) {
      clearSelectionEvents(hist.done);
      return lst(hist.done);
    } else if (hist.done.length && !lst(hist.done).ranges) {
      return lst(hist.done);
    } else if (hist.done.length > 1 && !hist.done[hist.done.length - 2].ranges) {
      hist.done.pop();
      return lst(hist.done);
    }
  }

  // Register a change in the history. Merges changes that are within
  // a single operation, ore are close together with an origin that
  // allows merging (starting with "+") into a single event.
  function addChangeToHistory(doc, change, selAfter, opId) {
    var hist = doc.history;
    hist.undone.length = 0;
    var time = +new Date, cur;

    if ((hist.lastOp == opId ||
         hist.lastOrigin == change.origin && change.origin &&
         ((change.origin.charAt(0) == "+" && doc.cm && hist.lastModTime > time - doc.cm.options.historyEventDelay) ||
          change.origin.charAt(0) == "*")) &&
        (cur = lastChangeEvent(hist, hist.lastOp == opId))) {
      // Merge this change into the last event
      var last = lst(cur.changes);
      if (cmp(change.from, change.to) == 0 && cmp(change.from, last.to) == 0) {
        // Optimized case for simple insertion -- don't want to add
        // new changesets for every character typed
        last.to = changeEnd(change);
      } else {
        // Add new sub-event
        cur.changes.push(historyChangeFromChange(doc, change));
      }
    } else {
      // Can not be merged, start a new event.
      var before = lst(hist.done);
      if (!before || !before.ranges)
        pushSelectionToHistory(doc.sel, hist.done);
      cur = {changes: [historyChangeFromChange(doc, change)],
             generation: hist.generation};
      hist.done.push(cur);
      while (hist.done.length > hist.undoDepth) {
        hist.done.shift();
        if (!hist.done[0].ranges) hist.done.shift();
      }
    }
    hist.done.push(selAfter);
    hist.generation = ++hist.maxGeneration;
    hist.lastModTime = hist.lastSelTime = time;
    hist.lastOp = hist.lastSelOp = opId;
    hist.lastOrigin = hist.lastSelOrigin = change.origin;

    if (!last) signal(doc, "historyAdded");
  }

  function selectionEventCanBeMerged(doc, origin, prev, sel) {
    var ch = origin.charAt(0);
    return ch == "*" ||
      ch == "+" &&
      prev.ranges.length == sel.ranges.length &&
      prev.somethingSelected() == sel.somethingSelected() &&
      new Date - doc.history.lastSelTime <= (doc.cm ? doc.cm.options.historyEventDelay : 500);
  }

  // Called whenever the selection changes, sets the new selection as
  // the pending selection in the history, and pushes the old pending
  // selection into the 'done' array when it was significantly
  // different (in number of selected ranges, emptiness, or time).
  function addSelectionToHistory(doc, sel, opId, options) {
    var hist = doc.history, origin = options && options.origin;

    // A new event is started when the previous origin does not match
    // the current, or the origins don't allow matching. Origins
    // starting with * are always merged, those starting with + are
    // merged when similar and close together in time.
    if (opId == hist.lastSelOp ||
        (origin && hist.lastSelOrigin == origin &&
         (hist.lastModTime == hist.lastSelTime && hist.lastOrigin == origin ||
          selectionEventCanBeMerged(doc, origin, lst(hist.done), sel))))
      hist.done[hist.done.length - 1] = sel;
    else
      pushSelectionToHistory(sel, hist.done);

    hist.lastSelTime = +new Date;
    hist.lastSelOrigin = origin;
    hist.lastSelOp = opId;
    if (options && options.clearRedo !== false)
      clearSelectionEvents(hist.undone);
  }

  function pushSelectionToHistory(sel, dest) {
    var top = lst(dest);
    if (!(top && top.ranges && top.equals(sel)))
      dest.push(sel);
  }

  // Used to store marked span information in the history.
  function attachLocalSpans(doc, change, from, to) {
    var existing = change["spans_" + doc.id], n = 0;
    doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function(line) {
      if (line.markedSpans)
        (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
      ++n;
    });
  }

  // When un/re-doing restores text containing marked spans, those
  // that have been explicitly cleared should not be restored.
  function removeClearedSpans(spans) {
    if (!spans) return null;
    for (var i = 0, out; i < spans.length; ++i) {
      if (spans[i].marker.explicitlyCleared) { if (!out) out = spans.slice(0, i); }
      else if (out) out.push(spans[i]);
    }
    return !out ? spans : out.length ? out : null;
  }

  // Retrieve and filter the old marked spans stored in a change event.
  function getOldSpans(doc, change) {
    var found = change["spans_" + doc.id];
    if (!found) return null;
    for (var i = 0, nw = []; i < change.text.length; ++i)
      nw.push(removeClearedSpans(found[i]));
    return nw;
  }

  // Used both to provide a JSON-safe object in .getHistory, and, when
  // detaching a document, to split the history in two
  function copyHistoryArray(events, newGroup, instantiateSel) {
    for (var i = 0, copy = []; i < events.length; ++i) {
      var event = events[i];
      if (event.ranges) {
        copy.push(instantiateSel ? Selection.prototype.deepCopy.call(event) : event);
        continue;
      }
      var changes = event.changes, newChanges = [];
      copy.push({changes: newChanges});
      for (var j = 0; j < changes.length; ++j) {
        var change = changes[j], m;
        newChanges.push({from: change.from, to: change.to, text: change.text});
        if (newGroup) for (var prop in change) if (m = prop.match(/^spans_(\d+)$/)) {
          if (indexOf(newGroup, Number(m[1])) > -1) {
            lst(newChanges)[prop] = change[prop];
            delete change[prop];
          }
        }
      }
    }
    return copy;
  }

  // Rebasing/resetting history to deal with externally-sourced changes

  function rebaseHistSelSingle(pos, from, to, diff) {
    if (to < pos.line) {
      pos.line += diff;
    } else if (from < pos.line) {
      pos.line = from;
      pos.ch = 0;
    }
  }

  // Tries to rebase an array of history events given a change in the
  // document. If the change touches the same lines as the event, the
  // event, and everything 'behind' it, is discarded. If the change is
  // before the event, the event's positions are updated. Uses a
  // copy-on-write scheme for the positions, to avoid having to
  // reallocate them all on every rebase, but also avoid problems with
  // shared position objects being unsafely updated.
  function rebaseHistArray(array, from, to, diff) {
    for (var i = 0; i < array.length; ++i) {
      var sub = array[i], ok = true;
      if (sub.ranges) {
        if (!sub.copied) { sub = array[i] = sub.deepCopy(); sub.copied = true; }
        for (var j = 0; j < sub.ranges.length; j++) {
          rebaseHistSelSingle(sub.ranges[j].anchor, from, to, diff);
          rebaseHistSelSingle(sub.ranges[j].head, from, to, diff);
        }
        continue;
      }
      for (var j = 0; j < sub.changes.length; ++j) {
        var cur = sub.changes[j];
        if (to < cur.from.line) {
          cur.from = Pos(cur.from.line + diff, cur.from.ch);
          cur.to = Pos(cur.to.line + diff, cur.to.ch);
        } else if (from <= cur.to.line) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        array.splice(0, i + 1);
        i = 0;
      }
    }
  }

  function rebaseHist(hist, change) {
    var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
    rebaseHistArray(hist.done, from, to, diff);
    rebaseHistArray(hist.undone, from, to, diff);
  }

  // EVENT UTILITIES

  // Due to the fact that we still support jurassic IE versions, some
  // compatibility wrappers are needed.

  var e_preventDefault = CodeMirror.e_preventDefault = function(e) {
    if (e.preventDefault) e.preventDefault();
    else e.returnValue = false;
  };
  var e_stopPropagation = CodeMirror.e_stopPropagation = function(e) {
    if (e.stopPropagation) e.stopPropagation();
    else e.cancelBubble = true;
  };
  function e_defaultPrevented(e) {
    return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false;
  }
  var e_stop = CodeMirror.e_stop = function(e) {e_preventDefault(e); e_stopPropagation(e);};

  function e_target(e) {return e.target || e.srcElement;}
  function e_button(e) {
    var b = e.which;
    if (b == null) {
      if (e.button & 1) b = 1;
      else if (e.button & 2) b = 3;
      else if (e.button & 4) b = 2;
    }
    if (mac && e.ctrlKey && b == 1) b = 3;
    return b;
  }

  // EVENT HANDLING

  // Lightweight event framework. on/off also work on DOM nodes,
  // registering native DOM handlers.

  var on = CodeMirror.on = function(emitter, type, f) {
    if (emitter.addEventListener)
      emitter.addEventListener(type, f, false);
    else if (emitter.attachEvent)
      emitter.attachEvent("on" + type, f);
    else {
      var map = emitter._handlers || (emitter._handlers = {});
      var arr = map[type] || (map[type] = []);
      arr.push(f);
    }
  };

  var off = CodeMirror.off = function(emitter, type, f) {
    if (emitter.removeEventListener)
      emitter.removeEventListener(type, f, false);
    else if (emitter.detachEvent)
      emitter.detachEvent("on" + type, f);
    else {
      var arr = emitter._handlers && emitter._handlers[type];
      if (!arr) return;
      for (var i = 0; i < arr.length; ++i)
        if (arr[i] == f) { arr.splice(i, 1); break; }
    }
  };

  var signal = CodeMirror.signal = function(emitter, type /*, values...*/) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < arr.length; ++i) arr[i].apply(null, args);
  };

  var orphanDelayedCallbacks = null;

  // Often, we want to signal events at a point where we are in the
  // middle of some work, but don't want the handler to start calling
  // other methods on the editor, which might be in an inconsistent
  // state or simply not expect any other events to happen.
  // signalLater looks whether there are any handlers, and schedules
  // them to be executed when the last operation ends, or, if no
  // operation is active, when a timeout fires.
  function signalLater(emitter, type /*, values...*/) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2), list;
    if (operationGroup) {
      list = operationGroup.delayedCallbacks;
    } else if (orphanDelayedCallbacks) {
      list = orphanDelayedCallbacks;
    } else {
      list = orphanDelayedCallbacks = [];
      setTimeout(fireOrphanDelayed, 0);
    }
    function bnd(f) {return function(){f.apply(null, args);};};
    for (var i = 0; i < arr.length; ++i)
      list.push(bnd(arr[i]));
  }

  function fireOrphanDelayed() {
    var delayed = orphanDelayedCallbacks;
    orphanDelayedCallbacks = null;
    for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }

  // The DOM events that CodeMirror handles can be overridden by
  // registering a (non-DOM) handler on the editor for the event name,
  // and preventDefault-ing the event in that handler.
  function signalDOMEvent(cm, e, override) {
    if (typeof e == "string")
      e = {type: e, preventDefault: function() { this.defaultPrevented = true; }};
    signal(cm, override || e.type, cm, e);
    return e_defaultPrevented(e) || e.codemirrorIgnore;
  }

  function signalCursorActivity(cm) {
    var arr = cm._handlers && cm._handlers.cursorActivity;
    if (!arr) return;
    var set = cm.curOp.cursorActivityHandlers || (cm.curOp.cursorActivityHandlers = []);
    for (var i = 0; i < arr.length; ++i) if (indexOf(set, arr[i]) == -1)
      set.push(arr[i]);
  }

  function hasHandler(emitter, type) {
    var arr = emitter._handlers && emitter._handlers[type];
    return arr && arr.length > 0;
  }

  // Add on and off methods to a constructor's prototype, to make
  // registering events on such objects more convenient.
  function eventMixin(ctor) {
    ctor.prototype.on = function(type, f) {on(this, type, f);};
    ctor.prototype.off = function(type, f) {off(this, type, f);};
  }

  // MISC UTILITIES

  // Number of pixels added to scroller and sizer to hide scrollbar
  var scrollerGap = 30;

  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  var Pass = CodeMirror.Pass = {toString: function(){return "CodeMirror.Pass";}};

  // Reused option objects for setSelection & friends
  var sel_dontScroll = {scroll: false}, sel_mouse = {origin: "*mouse"}, sel_move = {origin: "+move"};

  function Delayed() {this.id = null;}
  Delayed.prototype.set = function(ms, f) {
    clearTimeout(this.id);
    this.id = setTimeout(f, ms);
  };

  // Counts the column offset in a string, taking tabs into account.
  // Used mostly to find indentation.
  var countColumn = CodeMirror.countColumn = function(string, end, tabSize, startIndex, startValue) {
    if (end == null) {
      end = string.search(/[^\s\u00a0]/);
      if (end == -1) end = string.length;
    }
    for (var i = startIndex || 0, n = startValue || 0;;) {
      var nextTab = string.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= end)
        return n + (end - i);
      n += nextTab - i;
      n += tabSize - (n % tabSize);
      i = nextTab + 1;
    }
  };

  // The inverse of countColumn -- find the offset that corresponds to
  // a particular column.
  function findColumn(string, goal, tabSize) {
    for (var pos = 0, col = 0;;) {
      var nextTab = string.indexOf("\t", pos);
      if (nextTab == -1) nextTab = string.length;
      var skipped = nextTab - pos;
      if (nextTab == string.length || col + skipped >= goal)
        return pos + Math.min(skipped, goal - col);
      col += nextTab - pos;
      col += tabSize - (col % tabSize);
      pos = nextTab + 1;
      if (col >= goal) return pos;
    }
  }

  var spaceStrs = [""];
  function spaceStr(n) {
    while (spaceStrs.length <= n)
      spaceStrs.push(lst(spaceStrs) + " ");
    return spaceStrs[n];
  }

  function lst(arr) { return arr[arr.length-1]; }

  var selectInput = function(node) { node.select(); };
  if (ios) // Mobile Safari apparently has a bug where select() is broken.
    selectInput = function(node) { node.selectionStart = 0; node.selectionEnd = node.value.length; };
  else if (ie) // Suppress mysterious IE10 errors
    selectInput = function(node) { try { node.select(); } catch(_e) {} };

  function indexOf(array, elt) {
    for (var i = 0; i < array.length; ++i)
      if (array[i] == elt) return i;
    return -1;
  }
  function map(array, f) {
    var out = [];
    for (var i = 0; i < array.length; i++) out[i] = f(array[i], i);
    return out;
  }

  function createObj(base, props) {
    var inst;
    if (Object.create) {
      inst = Object.create(base);
    } else {
      var ctor = function() {};
      ctor.prototype = base;
      inst = new ctor();
    }
    if (props) copyObj(props, inst);
    return inst;
  };

  function copyObj(obj, target, overwrite) {
    if (!target) target = {};
    for (var prop in obj)
      if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop)))
        target[prop] = obj[prop];
    return target;
  }

  function bind(f) {
    var args = Array.prototype.slice.call(arguments, 1);
    return function(){return f.apply(null, args);};
  }

  var nonASCIISingleCaseWordChar = /[\u00df\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
  var isWordCharBasic = CodeMirror.isWordChar = function(ch) {
    return /\w/.test(ch) || ch > "\x80" &&
      (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
  };
  function isWordChar(ch, helper) {
    if (!helper) return isWordCharBasic(ch);
    if (helper.source.indexOf("\\w") > -1 && isWordCharBasic(ch)) return true;
    return helper.test(ch);
  }

  function isEmpty(obj) {
    for (var n in obj) if (obj.hasOwnProperty(n) && obj[n]) return false;
    return true;
  }

  // Extending unicode characters. A series of a non-extending char +
  // any number of extending chars is treated as a single unit as far
  // as editing and measuring is concerned. This is not fully correct,
  // since some scripts/fonts/browsers also treat other configurations
  // of code points as a group.
  var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/;
  function isExtendingChar(ch) { return ch.charCodeAt(0) >= 768 && extendingChars.test(ch); }

  // DOM UTILITIES

  function elt(tag, content, className, style) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (style) e.style.cssText = style;
    if (typeof content == "string") e.appendChild(document.createTextNode(content));
    else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
    return e;
  }

  var range;
  if (document.createRange) range = function(node, start, end) {
    var r = document.createRange();
    r.setEnd(node, end);
    r.setStart(node, start);
    return r;
  };
  else range = function(node, start, end) {
    var r = document.body.createTextRange();
    try { r.moveToElementText(node.parentNode); }
    catch(e) { return r; }
    r.collapse(true);
    r.moveEnd("character", end);
    r.moveStart("character", start);
    return r;
  };

  function removeChildren(e) {
    for (var count = e.childNodes.length; count > 0; --count)
      e.removeChild(e.firstChild);
    return e;
  }

  function removeChildrenAndAdd(parent, e) {
    return removeChildren(parent).appendChild(e);
  }

  function contains(parent, child) {
    if (parent.contains)
      return parent.contains(child);
    while (child = child.parentNode)
      if (child == parent) return true;
  }

  function activeElt() { return document.activeElement; }
  // Older versions of IE throws unspecified error when touching
  // document.activeElement in some cases (during loading, in iframe)
  if (ie && ie_version < 11) activeElt = function() {
    try { return document.activeElement; }
    catch(e) { return document.body; }
  };

  function classTest(cls) { return new RegExp("(^|\\s)" + cls + "(?:$|\\s)\\s*"); }
  var rmClass = CodeMirror.rmClass = function(node, cls) {
    var current = node.className;
    var match = classTest(cls).exec(current);
    if (match) {
      var after = current.slice(match.index + match[0].length);
      node.className = current.slice(0, match.index) + (after ? match[1] + after : "");
    }
  };
  var addClass = CodeMirror.addClass = function(node, cls) {
    var current = node.className;
    if (!classTest(cls).test(current)) node.className += (current ? " " : "") + cls;
  };
  function joinClasses(a, b) {
    var as = a.split(" ");
    for (var i = 0; i < as.length; i++)
      if (as[i] && !classTest(as[i]).test(b)) b += " " + as[i];
    return b;
  }

  // WINDOW-WIDE EVENTS

  // These must be handled carefully, because naively registering a
  // handler for each editor will cause the editors to never be
  // garbage collected.

  function forEachCodeMirror(f) {
    if (!document.body.getElementsByClassName) return;
    var byClass = document.body.getElementsByClassName("CodeMirror");
    for (var i = 0; i < byClass.length; i++) {
      var cm = byClass[i].CodeMirror;
      if (cm) f(cm);
    }
  }

  var globalsRegistered = false;
  function ensureGlobalHandlers() {
    if (globalsRegistered) return;
    registerGlobalHandlers();
    globalsRegistered = true;
  }
  function registerGlobalHandlers() {
    // When the window resizes, we need to refresh active editors.
    var resizeTimer;
    on(window, "resize", function() {
      if (resizeTimer == null) resizeTimer = setTimeout(function() {
        resizeTimer = null;
        forEachCodeMirror(onResize);
      }, 100);
    });
    // When the window loses focus, we want to show the editor as blurred
    on(window, "blur", function() {
      forEachCodeMirror(onBlur);
    });
  }

  // FEATURE DETECTION

  // Detect drag-and-drop
  var dragAndDrop = function() {
    // There is *some* kind of drag-and-drop support in IE6-8, but I
    // couldn't get it to work yet.
    if (ie && ie_version < 9) return false;
    var div = elt('div');
    return "draggable" in div || "dragDrop" in div;
  }();

  var zwspSupported;
  function zeroWidthElement(measure) {
    if (zwspSupported == null) {
      var test = elt("span", "\u200b");
      removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
      if (measure.firstChild.offsetHeight != 0)
        zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !(ie && ie_version < 8);
    }
    if (zwspSupported) return elt("span", "\u200b");
    else return elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
  }

  // Feature-detect IE's crummy client rect reporting for bidi text
  var badBidiRects;
  function hasBadBidiRects(measure) {
    if (badBidiRects != null) return badBidiRects;
    var txt = removeChildrenAndAdd(measure, document.createTextNode("A\u062eA"));
    var r0 = range(txt, 0, 1).getBoundingClientRect();
    if (!r0 || r0.left == r0.right) return false; // Safari returns null in some cases (#2780)
    var r1 = range(txt, 1, 2).getBoundingClientRect();
    return badBidiRects = (r1.right - r0.right < 3);
  }

  // See if "".split is the broken IE version, if so, provide an
  // alternative way to split lines.
  var splitLines = CodeMirror.splitLines = "\n\nb".split(/\n/).length != 3 ? function(string) {
    var pos = 0, result = [], l = string.length;
    while (pos <= l) {
      var nl = string.indexOf("\n", pos);
      if (nl == -1) nl = string.length;
      var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
      var rt = line.indexOf("\r");
      if (rt != -1) {
        result.push(line.slice(0, rt));
        pos += rt + 1;
      } else {
        result.push(line);
        pos = nl + 1;
      }
    }
    return result;
  } : function(string){return string.split(/\r\n?|\n/);};

  var hasSelection = window.getSelection ? function(te) {
    try { return te.selectionStart != te.selectionEnd; }
    catch(e) { return false; }
  } : function(te) {
    try {var range = te.ownerDocument.selection.createRange();}
    catch(e) {}
    if (!range || range.parentElement() != te) return false;
    return range.compareEndPoints("StartToEnd", range) != 0;
  };

  var hasCopyEvent = (function() {
    var e = elt("div");
    if ("oncopy" in e) return true;
    e.setAttribute("oncopy", "return;");
    return typeof e.oncopy == "function";
  })();

  var badZoomedRects = null;
  function hasBadZoomedRects(measure) {
    if (badZoomedRects != null) return badZoomedRects;
    var node = removeChildrenAndAdd(measure, elt("span", "x"));
    var normal = node.getBoundingClientRect();
    var fromRange = range(node, 0, 1).getBoundingClientRect();
    return badZoomedRects = Math.abs(normal.left - fromRange.left) > 1;
  }

  // KEY NAMES

  var keyNames = {3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
                  19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
                  36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
                  46: "Delete", 59: ";", 61: "=", 91: "Mod", 92: "Mod", 93: "Mod", 107: "=", 109: "-", 127: "Delete",
                  173: "-", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
                  221: "]", 222: "'", 63232: "Up", 63233: "Down", 63234: "Left", 63235: "Right", 63272: "Delete",
                  63273: "Home", 63275: "End", 63276: "PageUp", 63277: "PageDown", 63302: "Insert"};
  CodeMirror.keyNames = keyNames;
  (function() {
    // Number keys
    for (var i = 0; i < 10; i++) keyNames[i + 48] = keyNames[i + 96] = String(i);
    // Alphabetic keys
    for (var i = 65; i <= 90; i++) keyNames[i] = String.fromCharCode(i);
    // Function keys
    for (var i = 1; i <= 12; i++) keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
  })();

  // BIDI HELPERS

  function iterateBidiSections(order, from, to, f) {
    if (!order) return f(from, to, "ltr");
    var found = false;
    for (var i = 0; i < order.length; ++i) {
      var part = order[i];
      if (part.from < to && part.to > from || from == to && part.to == from) {
        f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
        found = true;
      }
    }
    if (!found) f(from, to, "ltr");
  }

  function bidiLeft(part) { return part.level % 2 ? part.to : part.from; }
  function bidiRight(part) { return part.level % 2 ? part.from : part.to; }

  function lineLeft(line) { var order = getOrder(line); return order ? bidiLeft(order[0]) : 0; }
  function lineRight(line) {
    var order = getOrder(line);
    if (!order) return line.text.length;
    return bidiRight(lst(order));
  }

  function lineStart(cm, lineN) {
    var line = getLine(cm.doc, lineN);
    var visual = visualLine(line);
    if (visual != line) lineN = lineNo(visual);
    var order = getOrder(visual);
    var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
    return Pos(lineN, ch);
  }
  function lineEnd(cm, lineN) {
    var merged, line = getLine(cm.doc, lineN);
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      lineN = null;
    }
    var order = getOrder(line);
    var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
    return Pos(lineN == null ? lineNo(line) : lineN, ch);
  }
  function lineStartSmart(cm, pos) {
    var start = lineStart(cm, pos.line);
    var line = getLine(cm.doc, start.line);
    var order = getOrder(line);
    if (!order || order[0].level == 0) {
      var firstNonWS = Math.max(0, line.text.search(/\S/));
      var inWS = pos.line == start.line && pos.ch <= firstNonWS && pos.ch;
      return Pos(start.line, inWS ? 0 : firstNonWS);
    }
    return start;
  }

  function compareBidiLevel(order, a, b) {
    var linedir = order[0].level;
    if (a == linedir) return true;
    if (b == linedir) return false;
    return a < b;
  }
  var bidiOther;
  function getBidiPartAt(order, pos) {
    bidiOther = null;
    for (var i = 0, found; i < order.length; ++i) {
      var cur = order[i];
      if (cur.from < pos && cur.to > pos) return i;
      if ((cur.from == pos || cur.to == pos)) {
        if (found == null) {
          found = i;
        } else if (compareBidiLevel(order, cur.level, order[found].level)) {
          if (cur.from != cur.to) bidiOther = found;
          return i;
        } else {
          if (cur.from != cur.to) bidiOther = i;
          return found;
        }
      }
    }
    return found;
  }

  function moveInLine(line, pos, dir, byUnit) {
    if (!byUnit) return pos + dir;
    do pos += dir;
    while (pos > 0 && isExtendingChar(line.text.charAt(pos)));
    return pos;
  }

  // This is needed in order to move 'visually' through bi-directional
  // text -- i.e., pressing left should make the cursor go left, even
  // when in RTL text. The tricky part is the 'jumps', where RTL and
  // LTR text touch each other. This often requires the cursor offset
  // to move more than one unit, in order to visually move one unit.
  function moveVisually(line, start, dir, byUnit) {
    var bidi = getOrder(line);
    if (!bidi) return moveLogically(line, start, dir, byUnit);
    var pos = getBidiPartAt(bidi, start), part = bidi[pos];
    var target = moveInLine(line, start, part.level % 2 ? -dir : dir, byUnit);

    for (;;) {
      if (target > part.from && target < part.to) return target;
      if (target == part.from || target == part.to) {
        if (getBidiPartAt(bidi, target) == pos) return target;
        part = bidi[pos += dir];
        return (dir > 0) == part.level % 2 ? part.to : part.from;
      } else {
        part = bidi[pos += dir];
        if (!part) return null;
        if ((dir > 0) == part.level % 2)
          target = moveInLine(line, part.to, -1, byUnit);
        else
          target = moveInLine(line, part.from, 1, byUnit);
      }
    }
  }

  function moveLogically(line, start, dir, byUnit) {
    var target = start + dir;
    if (byUnit) while (target > 0 && isExtendingChar(line.text.charAt(target))) target += dir;
    return target < 0 || target > line.text.length ? null : target;
  }

  // Bidirectional ordering algorithm
  // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
  // that this (partially) implements.

  // One-char codes used for character types:
  // L (L):   Left-to-Right
  // R (R):   Right-to-Left
  // r (AL):  Right-to-Left Arabic
  // 1 (EN):  European Number
  // + (ES):  European Number Separator
  // % (ET):  European Number Terminator
  // n (AN):  Arabic Number
  // , (CS):  Common Number Separator
  // m (NSM): Non-Spacing Mark
  // b (BN):  Boundary Neutral
  // s (B):   Paragraph Separator
  // t (S):   Segment Separator
  // w (WS):  Whitespace
  // N (ON):  Other Neutrals

  // Returns null if characters are ordered as they appear
  // (left-to-right), or an array of sections ({from, to, level}
  // objects) in the order in which they occur visually.
  var bidiOrdering = (function() {
    // Character types for codepoints 0 to 0xff
    var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";
    // Character types for codepoints 0x600 to 0x6ff
    var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmm";
    function charType(code) {
      if (code <= 0xf7) return lowTypes.charAt(code);
      else if (0x590 <= code && code <= 0x5f4) return "R";
      else if (0x600 <= code && code <= 0x6ed) return arabicTypes.charAt(code - 0x600);
      else if (0x6ee <= code && code <= 0x8ac) return "r";
      else if (0x2000 <= code && code <= 0x200b) return "w";
      else if (code == 0x200c) return "b";
      else return "L";
    }

    var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
    var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
    // Browsers seem to always treat the boundaries of block elements as being L.
    var outerType = "L";

    function BidiSpan(level, from, to) {
      this.level = level;
      this.from = from; this.to = to;
    }

    return function(str) {
      if (!bidiRE.test(str)) return false;
      var len = str.length, types = [];
      for (var i = 0, type; i < len; ++i)
        types.push(type = charType(str.charCodeAt(i)));

      // W1. Examine each non-spacing mark (NSM) in the level run, and
      // change the type of the NSM to the type of the previous
      // character. If the NSM is at the start of the level run, it will
      // get the type of sor.
      for (var i = 0, prev = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "m") types[i] = prev;
        else prev = type;
      }

      // W2. Search backwards from each instance of a European number
      // until the first strong type (R, L, AL, or sor) is found. If an
      // AL is found, change the type of the European number to Arabic
      // number.
      // W3. Change all ALs to R.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "1" && cur == "r") types[i] = "n";
        else if (isStrong.test(type)) { cur = type; if (type == "r") types[i] = "R"; }
      }

      // W4. A single European separator between two European numbers
      // changes to a European number. A single common separator between
      // two numbers of the same type changes to that type.
      for (var i = 1, prev = types[0]; i < len - 1; ++i) {
        var type = types[i];
        if (type == "+" && prev == "1" && types[i+1] == "1") types[i] = "1";
        else if (type == "," && prev == types[i+1] &&
                 (prev == "1" || prev == "n")) types[i] = prev;
        prev = type;
      }

      // W5. A sequence of European terminators adjacent to European
      // numbers changes to all European numbers.
      // W6. Otherwise, separators and terminators change to Other
      // Neutral.
      for (var i = 0; i < len; ++i) {
        var type = types[i];
        if (type == ",") types[i] = "N";
        else if (type == "%") {
          for (var end = i + 1; end < len && types[end] == "%"; ++end) {}
          var replace = (i && types[i-1] == "!") || (end < len && types[end] == "1") ? "1" : "N";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // W7. Search backwards from each instance of a European number
      // until the first strong type (R, L, or sor) is found. If an L is
      // found, then change the type of the European number to L.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (cur == "L" && type == "1") types[i] = "L";
        else if (isStrong.test(type)) cur = type;
      }

      // N1. A sequence of neutrals takes the direction of the
      // surrounding strong text if the text on both sides has the same
      // direction. European and Arabic numbers act as if they were R in
      // terms of their influence on neutrals. Start-of-level-run (sor)
      // and end-of-level-run (eor) are used at level run boundaries.
      // N2. Any remaining neutrals take the embedding direction.
      for (var i = 0; i < len; ++i) {
        if (isNeutral.test(types[i])) {
          for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {}
          var before = (i ? types[i-1] : outerType) == "L";
          var after = (end < len ? types[end] : outerType) == "L";
          var replace = before || after ? "L" : "R";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // Here we depart from the documented algorithm, in order to avoid
      // building up an actual levels array. Since there are only three
      // levels (0, 1, 2) in an implementation that doesn't take
      // explicit embedding into account, we can build up the order on
      // the fly, without following the level-based algorithm.
      var order = [], m;
      for (var i = 0; i < len;) {
        if (countsAsLeft.test(types[i])) {
          var start = i;
          for (++i; i < len && countsAsLeft.test(types[i]); ++i) {}
          order.push(new BidiSpan(0, start, i));
        } else {
          var pos = i, at = order.length;
          for (++i; i < len && types[i] != "L"; ++i) {}
          for (var j = pos; j < i;) {
            if (countsAsNum.test(types[j])) {
              if (pos < j) order.splice(at, 0, new BidiSpan(1, pos, j));
              var nstart = j;
              for (++j; j < i && countsAsNum.test(types[j]); ++j) {}
              order.splice(at, 0, new BidiSpan(2, nstart, j));
              pos = j;
            } else ++j;
          }
          if (pos < i) order.splice(at, 0, new BidiSpan(1, pos, i));
        }
      }
      if (order[0].level == 1 && (m = str.match(/^\s+/))) {
        order[0].from = m[0].length;
        order.unshift(new BidiSpan(0, 0, m[0].length));
      }
      if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
        lst(order).to -= m[0].length;
        order.push(new BidiSpan(0, len - m[0].length, len));
      }
      if (order[0].level != lst(order).level)
        order.push(new BidiSpan(order[0].level, len, len));

      return order;
    };
  })();

  // THE END

  CodeMirror.version = "4.12.0";

  return CodeMirror;
});

// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  function doFold(cm, pos, options, force) {
    if (options && options.call) {
      var finder = options;
      options = null;
    } else {
      var finder = getOption(cm, options, "rangeFinder");
    }
    if (typeof pos == "number") pos = CodeMirror.Pos(pos, 0);
    var minSize = getOption(cm, options, "minFoldSize");

    function getRange(allowFolded) {
      var range = finder(cm, pos);
      if (!range || range.to.line - range.from.line < minSize) return null;
      var marks = cm.findMarksAt(range.from);
      for (var i = 0; i < marks.length; ++i) {
        if (marks[i].__isFold && force !== "fold") {
          if (!allowFolded) return null;
          range.cleared = true;
          marks[i].clear();
        }
      }
      return range;
    }

    var range = getRange(true);
    if (getOption(cm, options, "scanUp")) while (!range && pos.line > cm.firstLine()) {
      pos = CodeMirror.Pos(pos.line - 1, 0);
      range = getRange(false);
    }
    if (!range || range.cleared || force === "unfold") return;

    var myWidget = makeWidget(cm, options);
    CodeMirror.on(myWidget, "mousedown", function(e) {
      myRange.clear();
      CodeMirror.e_preventDefault(e);
    });
    var myRange = cm.markText(range.from, range.to, {
      replacedWith: myWidget,
      clearOnEnter: true,
      __isFold: true
    });
    myRange.on("clear", function(from, to) {
      CodeMirror.signal(cm, "unfold", cm, from, to);
    });
    CodeMirror.signal(cm, "fold", cm, range.from, range.to);
  }

  function makeWidget(cm, options) {
    var widget = getOption(cm, options, "widget");
    if (typeof widget == "string") {
      var text = document.createTextNode(widget);
      widget = document.createElement("span");
      widget.appendChild(text);
      widget.className = "CodeMirror-foldmarker";
    }
    return widget;
  }

  // Clumsy backwards-compatible interface
  CodeMirror.newFoldFunction = function(rangeFinder, widget) {
    return function(cm, pos) { doFold(cm, pos, {rangeFinder: rangeFinder, widget: widget}); };
  };

  // New-style interface
  CodeMirror.defineExtension("foldCode", function(pos, options, force) {
    doFold(this, pos, options, force);
  });

  CodeMirror.defineExtension("isFolded", function(pos) {
    var marks = this.findMarksAt(pos);
    for (var i = 0; i < marks.length; ++i)
      if (marks[i].__isFold) return true;
  });

  CodeMirror.commands.toggleFold = function(cm) {
    cm.foldCode(cm.getCursor());
  };
  CodeMirror.commands.fold = function(cm) {
    cm.foldCode(cm.getCursor(), null, "fold");
  };
  CodeMirror.commands.unfold = function(cm) {
    cm.foldCode(cm.getCursor(), null, "unfold");
  };
  CodeMirror.commands.foldAll = function(cm) {
    cm.operation(function() {
      for (var i = cm.firstLine(), e = cm.lastLine(); i <= e; i++)
        cm.foldCode(CodeMirror.Pos(i, 0), null, "fold");
    });
  };
  CodeMirror.commands.unfoldAll = function(cm) {
    cm.operation(function() {
      for (var i = cm.firstLine(), e = cm.lastLine(); i <= e; i++)
        cm.foldCode(CodeMirror.Pos(i, 0), null, "unfold");
    });
  };

  CodeMirror.registerHelper("fold", "combine", function() {
    var funcs = Array.prototype.slice.call(arguments, 0);
    return function(cm, start) {
      for (var i = 0; i < funcs.length; ++i) {
        var found = funcs[i](cm, start);
        if (found) return found;
      }
    };
  });

  CodeMirror.registerHelper("fold", "auto", function(cm, start) {
    var helpers = cm.getHelpers(start, "fold");
    for (var i = 0; i < helpers.length; i++) {
      var cur = helpers[i](cm, start);
      if (cur) return cur;
    }
  });

  var defaultOptions = {
    rangeFinder: CodeMirror.fold.auto,
    widget: "\u2194",
    minFoldSize: 0,
    scanUp: false
  };

  CodeMirror.defineOption("foldOptions", null);

  function getOption(cm, options, name) {
    if (options && options[name] !== undefined)
      return options[name];
    var editorOptions = cm.options.foldOptions;
    if (editorOptions && editorOptions[name] !== undefined)
      return editorOptions[name];
    return defaultOptions[name];
  }

  CodeMirror.defineExtension("foldOption", function(options, name) {
    return getOption(this, options, name);
  });
});

// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
  "use strict";

  var Pos = CodeMirror.Pos;
  function cmp(a, b) { return a.line - b.line || a.ch - b.ch; }

  var nameStartChar = "A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
  var nameChar = nameStartChar + "\-\:\.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
  var xmlTagStart = new RegExp("<(/?)([" + nameStartChar + "][" + nameChar + "]*)", "g");

  function Iter(cm, line, ch, range) {
    this.line = line; this.ch = ch;
    this.cm = cm; this.text = cm.getLine(line);
    this.min = range ? range.from : cm.firstLine();
    this.max = range ? range.to - 1 : cm.lastLine();
  }

  function tagAt(iter, ch) {
    var type = iter.cm.getTokenTypeAt(Pos(iter.line, ch));
    return type && /\btag\b/.test(type);
  }

  function nextLine(iter) {
    if (iter.line >= iter.max) return;
    iter.ch = 0;
    iter.text = iter.cm.getLine(++iter.line);
    return true;
  }
  function prevLine(iter) {
    if (iter.line <= iter.min) return;
    iter.text = iter.cm.getLine(--iter.line);
    iter.ch = iter.text.length;
    return true;
  }

  function toTagEnd(iter) {
    for (;;) {
      var gt = iter.text.indexOf(">", iter.ch);
      if (gt == -1) { if (nextLine(iter)) continue; else return; }
      if (!tagAt(iter, gt + 1)) { iter.ch = gt + 1; continue; }
      var lastSlash = iter.text.lastIndexOf("/", gt);
      var selfClose = lastSlash > -1 && !/\S/.test(iter.text.slice(lastSlash + 1, gt));
      iter.ch = gt + 1;
      return selfClose ? "selfClose" : "regular";
    }
  }
  function toTagStart(iter) {
    for (;;) {
      var lt = iter.ch ? iter.text.lastIndexOf("<", iter.ch - 1) : -1;
      if (lt == -1) { if (prevLine(iter)) continue; else return; }
      if (!tagAt(iter, lt + 1)) { iter.ch = lt; continue; }
      xmlTagStart.lastIndex = lt;
      iter.ch = lt;
      var match = xmlTagStart.exec(iter.text);
      if (match && match.index == lt) return match;
    }
  }

  function toNextTag(iter) {
    for (;;) {
      xmlTagStart.lastIndex = iter.ch;
      var found = xmlTagStart.exec(iter.text);
      if (!found) { if (nextLine(iter)) continue; else return; }
      if (!tagAt(iter, found.index + 1)) { iter.ch = found.index + 1; continue; }
      iter.ch = found.index + found[0].length;
      return found;
    }
  }
  function toPrevTag(iter) {
    for (;;) {
      var gt = iter.ch ? iter.text.lastIndexOf(">", iter.ch - 1) : -1;
      if (gt == -1) { if (prevLine(iter)) continue; else return; }
      if (!tagAt(iter, gt + 1)) { iter.ch = gt; continue; }
      var lastSlash = iter.text.lastIndexOf("/", gt);
      var selfClose = lastSlash > -1 && !/\S/.test(iter.text.slice(lastSlash + 1, gt));
      iter.ch = gt + 1;
      return selfClose ? "selfClose" : "regular";
    }
  }

  function findMatchingClose(iter, tag) {
    var stack = [];
    for (;;) {
      var next = toNextTag(iter), end, startLine = iter.line, startCh = iter.ch - (next ? next[0].length : 0);
      if (!next || !(end = toTagEnd(iter))) return;
      if (end == "selfClose") continue;
      if (next[1]) { // closing tag
        for (var i = stack.length - 1; i >= 0; --i) if (stack[i] == next[2]) {
          stack.length = i;
          break;
        }
        if (i < 0 && (!tag || tag == next[2])) return {
          tag: next[2],
          from: Pos(startLine, startCh),
          to: Pos(iter.line, iter.ch)
        };
      } else { // opening tag
        stack.push(next[2]);
      }
    }
  }
  function findMatchingOpen(iter, tag) {
    var stack = [];
    for (;;) {
      var prev = toPrevTag(iter);
      if (!prev) return;
      if (prev == "selfClose") { toTagStart(iter); continue; }
      var endLine = iter.line, endCh = iter.ch;
      var start = toTagStart(iter);
      if (!start) return;
      if (start[1]) { // closing tag
        stack.push(start[2]);
      } else { // opening tag
        for (var i = stack.length - 1; i >= 0; --i) if (stack[i] == start[2]) {
          stack.length = i;
          break;
        }
        if (i < 0 && (!tag || tag == start[2])) return {
          tag: start[2],
          from: Pos(iter.line, iter.ch),
          to: Pos(endLine, endCh)
        };
      }
    }
  }

  CodeMirror.registerHelper("fold", "xml", function(cm, start) {
    var iter = new Iter(cm, start.line, 0);
    for (;;) {
      var openTag = toNextTag(iter), end;
      if (!openTag || iter.line != start.line || !(end = toTagEnd(iter))) return;
      if (!openTag[1] && end != "selfClose") {
        var start = Pos(iter.line, iter.ch);
        var close = findMatchingClose(iter, openTag[2]);
        return close && {from: start, to: close.from};
      }
    }
  });
  CodeMirror.findMatchingTag = function(cm, pos, range) {
    var iter = new Iter(cm, pos.line, pos.ch, range);
    if (iter.text.indexOf(">") == -1 && iter.text.indexOf("<") == -1) return;
    var end = toTagEnd(iter), to = end && Pos(iter.line, iter.ch);
    var start = end && toTagStart(iter);
    if (!end || !start || cmp(iter, pos) > 0) return;
    var here = {from: Pos(iter.line, iter.ch), to: to, tag: start[2]};
    if (end == "selfClose") return {open: here, close: null, at: "open"};

    if (start[1]) { // closing tag
      return {open: findMatchingOpen(iter, start[2]), close: here, at: "close"};
    } else { // opening tag
      iter = new Iter(cm, to.line, to.ch, range);
      return {open: here, close: findMatchingClose(iter, start[2]), at: "open"};
    }
  };

  CodeMirror.findEnclosingTag = function(cm, pos, range) {
    var iter = new Iter(cm, pos.line, pos.ch, range);
    for (;;) {
      var open = findMatchingOpen(iter);
      if (!open) break;
      var forward = new Iter(cm, pos.line, pos.ch, range);
      var close = findMatchingClose(forward, open.tag);
      if (close) return {open: open, close: close};
    }
  };

  // Used by addon/edit/closetag.js
  CodeMirror.scanForClosingTag = function(cm, pos, name, end) {
    var iter = new Iter(cm, pos.line, pos.ch, end ? {from: 0, to: end} : null);
    return findMatchingClose(iter, name);
  };
});

// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("xml", function(config, parserConfig) {
  var indentUnit = config.indentUnit;
  var multilineTagIndentFactor = parserConfig.multilineTagIndentFactor || 1;
  var multilineTagIndentPastTag = parserConfig.multilineTagIndentPastTag;
  if (multilineTagIndentPastTag == null) multilineTagIndentPastTag = true;

  var Kludges = parserConfig.htmlMode ? {
    autoSelfClosers: {'area': true, 'base': true, 'br': true, 'col': true, 'command': true,
                      'embed': true, 'frame': true, 'hr': true, 'img': true, 'input': true,
                      'keygen': true, 'link': true, 'meta': true, 'param': true, 'source': true,
                      'track': true, 'wbr': true, 'menuitem': true},
    implicitlyClosed: {'dd': true, 'li': true, 'optgroup': true, 'option': true, 'p': true,
                       'rp': true, 'rt': true, 'tbody': true, 'td': true, 'tfoot': true,
                       'th': true, 'tr': true},
    contextGrabbers: {
      'dd': {'dd': true, 'dt': true},
      'dt': {'dd': true, 'dt': true},
      'li': {'li': true},
      'option': {'option': true, 'optgroup': true},
      'optgroup': {'optgroup': true},
      'p': {'address': true, 'article': true, 'aside': true, 'blockquote': true, 'dir': true,
            'div': true, 'dl': true, 'fieldset': true, 'footer': true, 'form': true,
            'h1': true, 'h2': true, 'h3': true, 'h4': true, 'h5': true, 'h6': true,
            'header': true, 'hgroup': true, 'hr': true, 'menu': true, 'nav': true, 'ol': true,
            'p': true, 'pre': true, 'section': true, 'table': true, 'ul': true},
      'rp': {'rp': true, 'rt': true},
      'rt': {'rp': true, 'rt': true},
      'tbody': {'tbody': true, 'tfoot': true},
      'td': {'td': true, 'th': true},
      'tfoot': {'tbody': true},
      'th': {'td': true, 'th': true},
      'thead': {'tbody': true, 'tfoot': true},
      'tr': {'tr': true}
    },
    doNotIndent: {"pre": true},
    allowUnquoted: true,
    allowMissing: true,
    caseFold: true
  } : {
    autoSelfClosers: {},
    implicitlyClosed: {},
    contextGrabbers: {},
    doNotIndent: {},
    allowUnquoted: false,
    allowMissing: false,
    caseFold: false
  };
  var alignCDATA = parserConfig.alignCDATA;

  // Return variables for tokenizers
  var type, setStyle;

  function inText(stream, state) {
    function chain(parser) {
      state.tokenize = parser;
      return parser(stream, state);
    }

    var ch = stream.next();
    if (ch == "<") {
      if (stream.eat("!")) {
        if (stream.eat("[")) {
          if (stream.match("CDATA[")) return chain(inBlock("atom", "]]>"));
          else return null;
        } else if (stream.match("--")) {
          return chain(inBlock("comment", "-->"));
        } else if (stream.match("DOCTYPE", true, true)) {
          stream.eatWhile(/[\w\._\-]/);
          return chain(doctype(1));
        } else {
          return null;
        }
      } else if (stream.eat("?")) {
        stream.eatWhile(/[\w\._\-]/);
        state.tokenize = inBlock("meta", "?>");
        return "meta";
      } else {
        type = stream.eat("/") ? "closeTag" : "openTag";
        state.tokenize = inTag;
        return "tag bracket";
      }
    } else if (ch == "&") {
      var ok;
      if (stream.eat("#")) {
        if (stream.eat("x")) {
          ok = stream.eatWhile(/[a-fA-F\d]/) && stream.eat(";");
        } else {
          ok = stream.eatWhile(/[\d]/) && stream.eat(";");
        }
      } else {
        ok = stream.eatWhile(/[\w\.\-:]/) && stream.eat(";");
      }
      return ok ? "atom" : "error";
    } else {
      stream.eatWhile(/[^&<]/);
      return null;
    }
  }

  function inTag(stream, state) {
    var ch = stream.next();
    if (ch == ">" || (ch == "/" && stream.eat(">"))) {
      state.tokenize = inText;
      type = ch == ">" ? "endTag" : "selfcloseTag";
      return "tag bracket";
    } else if (ch == "=") {
      type = "equals";
      return null;
    } else if (ch == "<") {
      state.tokenize = inText;
      state.state = baseState;
      state.tagName = state.tagStart = null;
      var next = state.tokenize(stream, state);
      return next ? next + " tag error" : "tag error";
    } else if (/[\'\"]/.test(ch)) {
      state.tokenize = inAttribute(ch);
      state.stringStartCol = stream.column();
      return state.tokenize(stream, state);
    } else {
      stream.match(/^[^\s\u00a0=<>\"\']*[^\s\u00a0=<>\"\'\/]/);
      return "word";
    }
  }

  function inAttribute(quote) {
    var closure = function(stream, state) {
      while (!stream.eol()) {
        if (stream.next() == quote) {
          state.tokenize = inTag;
          break;
        }
      }
      return "string";
    };
    closure.isInAttribute = true;
    return closure;
  }

  function inBlock(style, terminator) {
    return function(stream, state) {
      while (!stream.eol()) {
        if (stream.match(terminator)) {
          state.tokenize = inText;
          break;
        }
        stream.next();
      }
      return style;
    };
  }
  function doctype(depth) {
    return function(stream, state) {
      var ch;
      while ((ch = stream.next()) != null) {
        if (ch == "<") {
          state.tokenize = doctype(depth + 1);
          return state.tokenize(stream, state);
        } else if (ch == ">") {
          if (depth == 1) {
            state.tokenize = inText;
            break;
          } else {
            state.tokenize = doctype(depth - 1);
            return state.tokenize(stream, state);
          }
        }
      }
      return "meta";
    };
  }

  function Context(state, tagName, startOfLine) {
    this.prev = state.context;
    this.tagName = tagName;
    this.indent = state.indented;
    this.startOfLine = startOfLine;
    if (Kludges.doNotIndent.hasOwnProperty(tagName) || (state.context && state.context.noIndent))
      this.noIndent = true;
  }
  function popContext(state) {
    if (state.context) state.context = state.context.prev;
  }
  function maybePopContext(state, nextTagName) {
    var parentTagName;
    while (true) {
      if (!state.context) {
        return;
      }
      parentTagName = state.context.tagName;
      if (!Kludges.contextGrabbers.hasOwnProperty(parentTagName) ||
          !Kludges.contextGrabbers[parentTagName].hasOwnProperty(nextTagName)) {
        return;
      }
      popContext(state);
    }
  }

  function baseState(type, stream, state) {
    if (type == "openTag") {
      state.tagStart = stream.column();
      return tagNameState;
    } else if (type == "closeTag") {
      return closeTagNameState;
    } else {
      return baseState;
    }
  }
  function tagNameState(type, stream, state) {
    if (type == "word") {
      state.tagName = stream.current();
      setStyle = "tag";
      return attrState;
    } else {
      setStyle = "error";
      return tagNameState;
    }
  }
  function closeTagNameState(type, stream, state) {
    if (type == "word") {
      var tagName = stream.current();
      if (state.context && state.context.tagName != tagName &&
          Kludges.implicitlyClosed.hasOwnProperty(state.context.tagName))
        popContext(state);
      if (state.context && state.context.tagName == tagName) {
        setStyle = "tag";
        return closeState;
      } else {
        setStyle = "tag error";
        return closeStateErr;
      }
    } else {
      setStyle = "error";
      return closeStateErr;
    }
  }

  function closeState(type, _stream, state) {
    if (type != "endTag") {
      setStyle = "error";
      return closeState;
    }
    popContext(state);
    return baseState;
  }
  function closeStateErr(type, stream, state) {
    setStyle = "error";
    return closeState(type, stream, state);
  }

  function attrState(type, _stream, state) {
    if (type == "word") {
      setStyle = "attribute";
      return attrEqState;
    } else if (type == "endTag" || type == "selfcloseTag") {
      var tagName = state.tagName, tagStart = state.tagStart;
      state.tagName = state.tagStart = null;
      if (type == "selfcloseTag" ||
          Kludges.autoSelfClosers.hasOwnProperty(tagName)) {
        maybePopContext(state, tagName);
      } else {
        maybePopContext(state, tagName);
        state.context = new Context(state, tagName, tagStart == state.indented);
      }
      return baseState;
    }
    setStyle = "error";
    return attrState;
  }
  function attrEqState(type, stream, state) {
    if (type == "equals") return attrValueState;
    if (!Kludges.allowMissing) setStyle = "error";
    return attrState(type, stream, state);
  }
  function attrValueState(type, stream, state) {
    if (type == "string") return attrContinuedState;
    if (type == "word" && Kludges.allowUnquoted) {setStyle = "string"; return attrState;}
    setStyle = "error";
    return attrState(type, stream, state);
  }
  function attrContinuedState(type, stream, state) {
    if (type == "string") return attrContinuedState;
    return attrState(type, stream, state);
  }

  return {
    startState: function() {
      return {tokenize: inText,
              state: baseState,
              indented: 0,
              tagName: null, tagStart: null,
              context: null};
    },

    token: function(stream, state) {
      if (!state.tagName && stream.sol())
        state.indented = stream.indentation();

      if (stream.eatSpace()) return null;
      type = null;
      var style = state.tokenize(stream, state);
      if ((style || type) && style != "comment") {
        setStyle = null;
        state.state = state.state(type || style, stream, state);
        if (setStyle)
          style = setStyle == "error" ? style + " error" : setStyle;
      }
      return style;
    },

    indent: function(state, textAfter, fullLine) {
      var context = state.context;
      // Indent multi-line strings (e.g. css).
      if (state.tokenize.isInAttribute) {
        if (state.tagStart == state.indented)
          return state.stringStartCol + 1;
        else
          return state.indented + indentUnit;
      }
      if (context && context.noIndent) return CodeMirror.Pass;
      if (state.tokenize != inTag && state.tokenize != inText)
        return fullLine ? fullLine.match(/^(\s*)/)[0].length : 0;
      // Indent the starts of attribute names.
      if (state.tagName) {
        if (multilineTagIndentPastTag)
          return state.tagStart + state.tagName.length + 2;
        else
          return state.tagStart + indentUnit * multilineTagIndentFactor;
      }
      if (alignCDATA && /<!\[CDATA\[/.test(textAfter)) return 0;
      var tagAfter = textAfter && /^<(\/)?([\w_:\.-]*)/.exec(textAfter);
      if (tagAfter && tagAfter[1]) { // Closing tag spotted
        while (context) {
          if (context.tagName == tagAfter[2]) {
            context = context.prev;
            break;
          } else if (Kludges.implicitlyClosed.hasOwnProperty(context.tagName)) {
            context = context.prev;
          } else {
            break;
          }
        }
      } else if (tagAfter) { // Opening tag spotted
        while (context) {
          var grabbers = Kludges.contextGrabbers[context.tagName];
          if (grabbers && grabbers.hasOwnProperty(tagAfter[2]))
            context = context.prev;
          else
            break;
        }
      }
      while (context && !context.startOfLine)
        context = context.prev;
      if (context) return context.indent + indentUnit;
      else return 0;
    },

    electricInput: /<\/[\s\w:]+>$/,
    blockCommentStart: "<!--",
    blockCommentEnd: "-->",

    configuration: parserConfig.htmlMode ? "html" : "xml",
    helperType: parserConfig.htmlMode ? "html" : "xml"
  };
});

CodeMirror.defineMIME("text/xml", "xml");
CodeMirror.defineMIME("application/xml", "xml");
if (!CodeMirror.mimeModes.hasOwnProperty("text/html"))
  CodeMirror.defineMIME("text/html", {name: "xml", htmlMode: true});

});

// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// TODO actually recognize syntax of TypeScript constructs

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("javascript", function(config, parserConfig) {
  var indentUnit = config.indentUnit;
  var statementIndent = parserConfig.statementIndent;
  var jsonldMode = parserConfig.jsonld;
  var jsonMode = parserConfig.json || jsonldMode;
  var isTS = parserConfig.typescript;
  var wordRE = parserConfig.wordCharacters || /[\w$\xa1-\uffff]/;

  // Tokenizer

  var keywords = function(){
    function kw(type) {return {type: type, style: "keyword"};}
    var A = kw("keyword a"), B = kw("keyword b"), C = kw("keyword c");
    var operator = kw("operator"), atom = {type: "atom", style: "atom"};

    var jsKeywords = {
      "if": kw("if"), "while": A, "with": A, "else": B, "do": B, "try": B, "finally": B,
      "return": C, "break": C, "continue": C, "new": C, "delete": C, "throw": C, "debugger": C,
      "var": kw("var"), "const": kw("var"), "let": kw("var"),
      "function": kw("function"), "catch": kw("catch"),
      "for": kw("for"), "switch": kw("switch"), "case": kw("case"), "default": kw("default"),
      "in": operator, "typeof": operator, "instanceof": operator,
      "true": atom, "false": atom, "null": atom, "undefined": atom, "NaN": atom, "Infinity": atom,
      "this": kw("this"), "module": kw("module"), "class": kw("class"), "super": kw("atom"),
      "yield": C, "export": kw("export"), "import": kw("import"), "extends": C
    };

    // Extend the 'normal' keywords with the TypeScript language extensions
    if (isTS) {
      var type = {type: "variable", style: "variable-3"};
      var tsKeywords = {
        // object-like things
        "interface": kw("interface"),
        "extends": kw("extends"),
        "constructor": kw("constructor"),

        // scope modifiers
        "public": kw("public"),
        "private": kw("private"),
        "protected": kw("protected"),
        "static": kw("static"),

        // types
        "string": type, "number": type, "bool": type, "any": type
      };

      for (var attr in tsKeywords) {
        jsKeywords[attr] = tsKeywords[attr];
      }
    }

    return jsKeywords;
  }();

  var isOperatorChar = /[+\-*&%=<>!?|~^]/;
  var isJsonldKeyword = /^@(context|id|value|language|type|container|list|set|reverse|index|base|vocab|graph)"/;

  function readRegexp(stream) {
    var escaped = false, next, inSet = false;
    while ((next = stream.next()) != null) {
      if (!escaped) {
        if (next == "/" && !inSet) return;
        if (next == "[") inSet = true;
        else if (inSet && next == "]") inSet = false;
      }
      escaped = !escaped && next == "\\";
    }
  }

  // Used as scratch variables to communicate multiple values without
  // consing up tons of objects.
  var type, content;
  function ret(tp, style, cont) {
    type = tp; content = cont;
    return style;
  }
  function tokenBase(stream, state) {
    var ch = stream.next();
    if (ch == '"' || ch == "'") {
      state.tokenize = tokenString(ch);
      return state.tokenize(stream, state);
    } else if (ch == "." && stream.match(/^\d+(?:[eE][+\-]?\d+)?/)) {
      return ret("number", "number");
    } else if (ch == "." && stream.match("..")) {
      return ret("spread", "meta");
    } else if (/[\[\]{}\(\),;\:\.]/.test(ch)) {
      return ret(ch);
    } else if (ch == "=" && stream.eat(">")) {
      return ret("=>", "operator");
    } else if (ch == "0" && stream.eat(/x/i)) {
      stream.eatWhile(/[\da-f]/i);
      return ret("number", "number");
    } else if (/\d/.test(ch)) {
      stream.match(/^\d*(?:\.\d*)?(?:[eE][+\-]?\d+)?/);
      return ret("number", "number");
    } else if (ch == "/") {
      if (stream.eat("*")) {
        state.tokenize = tokenComment;
        return tokenComment(stream, state);
      } else if (stream.eat("/")) {
        stream.skipToEnd();
        return ret("comment", "comment");
      } else if (state.lastType == "operator" || state.lastType == "keyword c" ||
               state.lastType == "sof" || /^[\[{}\(,;:]$/.test(state.lastType)) {
        readRegexp(stream);
        stream.eatWhile(/[gimy]/); // 'y' is "sticky" option in Mozilla
        return ret("regexp", "string-2");
      } else {
        stream.eatWhile(isOperatorChar);
        return ret("operator", "operator", stream.current());
      }
    } else if (ch == "`") {
      state.tokenize = tokenQuasi;
      return tokenQuasi(stream, state);
    } else if (ch == "#") {
      stream.skipToEnd();
      return ret("error", "error");
    } else if (isOperatorChar.test(ch)) {
      stream.eatWhile(isOperatorChar);
      return ret("operator", "operator", stream.current());
    } else if (wordRE.test(ch)) {
      stream.eatWhile(wordRE);
      var word = stream.current(), known = keywords.propertyIsEnumerable(word) && keywords[word];
      return (known && state.lastType != ".") ? ret(known.type, known.style, word) :
                     ret("variable", "variable", word);
    }
  }

  function tokenString(quote) {
    return function(stream, state) {
      var escaped = false, next;
      if (jsonldMode && stream.peek() == "@" && stream.match(isJsonldKeyword)){
        state.tokenize = tokenBase;
        return ret("jsonld-keyword", "meta");
      }
      while ((next = stream.next()) != null) {
        if (next == quote && !escaped) break;
        escaped = !escaped && next == "\\";
      }
      if (!escaped) state.tokenize = tokenBase;
      return ret("string", "string");
    };
  }

  function tokenComment(stream, state) {
    var maybeEnd = false, ch;
    while (ch = stream.next()) {
      if (ch == "/" && maybeEnd) {
        state.tokenize = tokenBase;
        break;
      }
      maybeEnd = (ch == "*");
    }
    return ret("comment", "comment");
  }

  function tokenQuasi(stream, state) {
    var escaped = false, next;
    while ((next = stream.next()) != null) {
      if (!escaped && (next == "`" || next == "$" && stream.eat("{"))) {
        state.tokenize = tokenBase;
        break;
      }
      escaped = !escaped && next == "\\";
    }
    return ret("quasi", "string-2", stream.current());
  }

  var brackets = "([{}])";
  // This is a crude lookahead trick to try and notice that we're
  // parsing the argument patterns for a fat-arrow function before we
  // actually hit the arrow token. It only works if the arrow is on
  // the same line as the arguments and there's no strange noise
  // (comments) in between. Fallback is to only notice when we hit the
  // arrow, and not declare the arguments as locals for the arrow
  // body.
  function findFatArrow(stream, state) {
    if (state.fatArrowAt) state.fatArrowAt = null;
    var arrow = stream.string.indexOf("=>", stream.start);
    if (arrow < 0) return;

    var depth = 0, sawSomething = false;
    for (var pos = arrow - 1; pos >= 0; --pos) {
      var ch = stream.string.charAt(pos);
      var bracket = brackets.indexOf(ch);
      if (bracket >= 0 && bracket < 3) {
        if (!depth) { ++pos; break; }
        if (--depth == 0) break;
      } else if (bracket >= 3 && bracket < 6) {
        ++depth;
      } else if (wordRE.test(ch)) {
        sawSomething = true;
      } else if (/["'\/]/.test(ch)) {
        return;
      } else if (sawSomething && !depth) {
        ++pos;
        break;
      }
    }
    if (sawSomething && !depth) state.fatArrowAt = pos;
  }

  // Parser

  var atomicTypes = {"atom": true, "number": true, "variable": true, "string": true, "regexp": true, "this": true, "jsonld-keyword": true};

  function JSLexical(indented, column, type, align, prev, info) {
    this.indented = indented;
    this.column = column;
    this.type = type;
    this.prev = prev;
    this.info = info;
    if (align != null) this.align = align;
  }

  function inScope(state, varname) {
    for (var v = state.localVars; v; v = v.next)
      if (v.name == varname) return true;
    for (var cx = state.context; cx; cx = cx.prev) {
      for (var v = cx.vars; v; v = v.next)
        if (v.name == varname) return true;
    }
  }

  function parseJS(state, style, type, content, stream) {
    var cc = state.cc;
    // Communicate our context to the combinators.
    // (Less wasteful than consing up a hundred closures on every call.)
    cx.state = state; cx.stream = stream; cx.marked = null, cx.cc = cc; cx.style = style;

    if (!state.lexical.hasOwnProperty("align"))
      state.lexical.align = true;

    while(true) {
      var combinator = cc.length ? cc.pop() : jsonMode ? expression : statement;
      if (combinator(type, content)) {
        while(cc.length && cc[cc.length - 1].lex)
          cc.pop()();
        if (cx.marked) return cx.marked;
        if (type == "variable" && inScope(state, content)) return "variable-2";
        return style;
      }
    }
  }

  // Combinator utils

  var cx = {state: null, column: null, marked: null, cc: null};
  function pass() {
    for (var i = arguments.length - 1; i >= 0; i--) cx.cc.push(arguments[i]);
  }
  function cont() {
    pass.apply(null, arguments);
    return true;
  }
  function register(varname) {
    function inList(list) {
      for (var v = list; v; v = v.next)
        if (v.name == varname) return true;
      return false;
    }
    var state = cx.state;
    if (state.context) {
      cx.marked = "def";
      if (inList(state.localVars)) return;
      state.localVars = {name: varname, next: state.localVars};
    } else {
      if (inList(state.globalVars)) return;
      if (parserConfig.globalVars)
        state.globalVars = {name: varname, next: state.globalVars};
    }
  }

  // Combinators

  var defaultVars = {name: "this", next: {name: "arguments"}};
  function pushcontext() {
    cx.state.context = {prev: cx.state.context, vars: cx.state.localVars};
    cx.state.localVars = defaultVars;
  }
  function popcontext() {
    cx.state.localVars = cx.state.context.vars;
    cx.state.context = cx.state.context.prev;
  }
  function pushlex(type, info) {
    var result = function() {
      var state = cx.state, indent = state.indented;
      if (state.lexical.type == "stat") indent = state.lexical.indented;
      else for (var outer = state.lexical; outer && outer.type == ")" && outer.align; outer = outer.prev)
        indent = outer.indented;
      state.lexical = new JSLexical(indent, cx.stream.column(), type, null, state.lexical, info);
    };
    result.lex = true;
    return result;
  }
  function poplex() {
    var state = cx.state;
    if (state.lexical.prev) {
      if (state.lexical.type == ")")
        state.indented = state.lexical.indented;
      state.lexical = state.lexical.prev;
    }
  }
  poplex.lex = true;

  function expect(wanted) {
    function exp(type) {
      if (type == wanted) return cont();
      else if (wanted == ";") return pass();
      else return cont(exp);
    };
    return exp;
  }

  function statement(type, value) {
    if (type == "var") return cont(pushlex("vardef", value.length), vardef, expect(";"), poplex);
    if (type == "keyword a") return cont(pushlex("form"), expression, statement, poplex);
    if (type == "keyword b") return cont(pushlex("form"), statement, poplex);
    if (type == "{") return cont(pushlex("}"), block, poplex);
    if (type == ";") return cont();
    if (type == "if") {
      if (cx.state.lexical.info == "else" && cx.state.cc[cx.state.cc.length - 1] == poplex)
        cx.state.cc.pop()();
      return cont(pushlex("form"), expression, statement, poplex, maybeelse);
    }
    if (type == "function") return cont(functiondef);
    if (type == "for") return cont(pushlex("form"), forspec, statement, poplex);
    if (type == "variable") return cont(pushlex("stat"), maybelabel);
    if (type == "switch") return cont(pushlex("form"), expression, pushlex("}", "switch"), expect("{"),
                                      block, poplex, poplex);
    if (type == "case") return cont(expression, expect(":"));
    if (type == "default") return cont(expect(":"));
    if (type == "catch") return cont(pushlex("form"), pushcontext, expect("("), funarg, expect(")"),
                                     statement, poplex, popcontext);
    if (type == "module") return cont(pushlex("form"), pushcontext, afterModule, popcontext, poplex);
    if (type == "class") return cont(pushlex("form"), className, poplex);
    if (type == "export") return cont(pushlex("form"), afterExport, poplex);
    if (type == "import") return cont(pushlex("form"), afterImport, poplex);
    return pass(pushlex("stat"), expression, expect(";"), poplex);
  }
  function expression(type) {
    return expressionInner(type, false);
  }
  function expressionNoComma(type) {
    return expressionInner(type, true);
  }
  function expressionInner(type, noComma) {
    if (cx.state.fatArrowAt == cx.stream.start) {
      var body = noComma ? arrowBodyNoComma : arrowBody;
      if (type == "(") return cont(pushcontext, pushlex(")"), commasep(pattern, ")"), poplex, expect("=>"), body, popcontext);
      else if (type == "variable") return pass(pushcontext, pattern, expect("=>"), body, popcontext);
    }

    var maybeop = noComma ? maybeoperatorNoComma : maybeoperatorComma;
    if (atomicTypes.hasOwnProperty(type)) return cont(maybeop);
    if (type == "function") return cont(functiondef, maybeop);
    if (type == "keyword c") return cont(noComma ? maybeexpressionNoComma : maybeexpression);
    if (type == "(") return cont(pushlex(")"), maybeexpression, comprehension, expect(")"), poplex, maybeop);
    if (type == "operator" || type == "spread") return cont(noComma ? expressionNoComma : expression);
    if (type == "[") return cont(pushlex("]"), arrayLiteral, poplex, maybeop);
    if (type == "{") return contCommasep(objprop, "}", null, maybeop);
    if (type == "quasi") { return pass(quasi, maybeop); }
    return cont();
  }
  function maybeexpression(type) {
    if (type.match(/[;\}\)\],]/)) return pass();
    return pass(expression);
  }
  function maybeexpressionNoComma(type) {
    if (type.match(/[;\}\)\],]/)) return pass();
    return pass(expressionNoComma);
  }

  function maybeoperatorComma(type, value) {
    if (type == ",") return cont(expression);
    return maybeoperatorNoComma(type, value, false);
  }
  function maybeoperatorNoComma(type, value, noComma) {
    var me = noComma == false ? maybeoperatorComma : maybeoperatorNoComma;
    var expr = noComma == false ? expression : expressionNoComma;
    if (type == "=>") return cont(pushcontext, noComma ? arrowBodyNoComma : arrowBody, popcontext);
    if (type == "operator") {
      if (/\+\+|--/.test(value)) return cont(me);
      if (value == "?") return cont(expression, expect(":"), expr);
      return cont(expr);
    }
    if (type == "quasi") { return pass(quasi, me); }
    if (type == ";") return;
    if (type == "(") return contCommasep(expressionNoComma, ")", "call", me);
    if (type == ".") return cont(property, me);
    if (type == "[") return cont(pushlex("]"), maybeexpression, expect("]"), poplex, me);
  }
  function quasi(type, value) {
    if (type != "quasi") return pass();
    if (value.slice(value.length - 2) != "${") return cont(quasi);
    return cont(expression, continueQuasi);
  }
  function continueQuasi(type) {
    if (type == "}") {
      cx.marked = "string-2";
      cx.state.tokenize = tokenQuasi;
      return cont(quasi);
    }
  }
  function arrowBody(type) {
    findFatArrow(cx.stream, cx.state);
    return pass(type == "{" ? statement : expression);
  }
  function arrowBodyNoComma(type) {
    findFatArrow(cx.stream, cx.state);
    return pass(type == "{" ? statement : expressionNoComma);
  }
  function maybelabel(type) {
    if (type == ":") return cont(poplex, statement);
    return pass(maybeoperatorComma, expect(";"), poplex);
  }
  function property(type) {
    if (type == "variable") {cx.marked = "property"; return cont();}
  }
  function objprop(type, value) {
    if (type == "variable" || cx.style == "keyword") {
      cx.marked = "property";
      if (value == "get" || value == "set") return cont(getterSetter);
      return cont(afterprop);
    } else if (type == "number" || type == "string") {
      cx.marked = jsonldMode ? "property" : (cx.style + " property");
      return cont(afterprop);
    } else if (type == "jsonld-keyword") {
      return cont(afterprop);
    } else if (type == "[") {
      return cont(expression, expect("]"), afterprop);
    }
  }
  function getterSetter(type) {
    if (type != "variable") return pass(afterprop);
    cx.marked = "property";
    return cont(functiondef);
  }
  function afterprop(type) {
    if (type == ":") return cont(expressionNoComma);
    if (type == "(") return pass(functiondef);
  }
  function commasep(what, end) {
    function proceed(type) {
      if (type == ",") {
        var lex = cx.state.lexical;
        if (lex.info == "call") lex.pos = (lex.pos || 0) + 1;
        return cont(what, proceed);
      }
      if (type == end) return cont();
      return cont(expect(end));
    }
    return function(type) {
      if (type == end) return cont();
      return pass(what, proceed);
    };
  }
  function contCommasep(what, end, info) {
    for (var i = 3; i < arguments.length; i++)
      cx.cc.push(arguments[i]);
    return cont(pushlex(end, info), commasep(what, end), poplex);
  }
  function block(type) {
    if (type == "}") return cont();
    return pass(statement, block);
  }
  function maybetype(type) {
    if (isTS && type == ":") return cont(typedef);
  }
  function typedef(type) {
    if (type == "variable"){cx.marked = "variable-3"; return cont();}
  }
  function vardef() {
    return pass(pattern, maybetype, maybeAssign, vardefCont);
  }
  function pattern(type, value) {
    if (type == "variable") { register(value); return cont(); }
    if (type == "[") return contCommasep(pattern, "]");
    if (type == "{") return contCommasep(proppattern, "}");
  }
  function proppattern(type, value) {
    if (type == "variable" && !cx.stream.match(/^\s*:/, false)) {
      register(value);
      return cont(maybeAssign);
    }
    if (type == "variable") cx.marked = "property";
    return cont(expect(":"), pattern, maybeAssign);
  }
  function maybeAssign(_type, value) {
    if (value == "=") return cont(expressionNoComma);
  }
  function vardefCont(type) {
    if (type == ",") return cont(vardef);
  }
  function maybeelse(type, value) {
    if (type == "keyword b" && value == "else") return cont(pushlex("form", "else"), statement, poplex);
  }
  function forspec(type) {
    if (type == "(") return cont(pushlex(")"), forspec1, expect(")"), poplex);
  }
  function forspec1(type) {
    if (type == "var") return cont(vardef, expect(";"), forspec2);
    if (type == ";") return cont(forspec2);
    if (type == "variable") return cont(formaybeinof);
    return pass(expression, expect(";"), forspec2);
  }
  function formaybeinof(_type, value) {
    if (value == "in" || value == "of") { cx.marked = "keyword"; return cont(expression); }
    return cont(maybeoperatorComma, forspec2);
  }
  function forspec2(type, value) {
    if (type == ";") return cont(forspec3);
    if (value == "in" || value == "of") { cx.marked = "keyword"; return cont(expression); }
    return pass(expression, expect(";"), forspec3);
  }
  function forspec3(type) {
    if (type != ")") cont(expression);
  }
  function functiondef(type, value) {
    if (value == "*") {cx.marked = "keyword"; return cont(functiondef);}
    if (type == "variable") {register(value); return cont(functiondef);}
    if (type == "(") return cont(pushcontext, pushlex(")"), commasep(funarg, ")"), poplex, statement, popcontext);
  }
  function funarg(type) {
    if (type == "spread") return cont(funarg);
    return pass(pattern, maybetype);
  }
  function className(type, value) {
    if (type == "variable") {register(value); return cont(classNameAfter);}
  }
  function classNameAfter(type, value) {
    if (value == "extends") return cont(expression, classNameAfter);
    if (type == "{") return cont(pushlex("}"), classBody, poplex);
  }
  function classBody(type, value) {
    if (type == "variable" || cx.style == "keyword") {
      cx.marked = "property";
      if (value == "get" || value == "set") return cont(classGetterSetter, functiondef, classBody);
      return cont(functiondef, classBody);
    }
    if (value == "*") {
      cx.marked = "keyword";
      return cont(classBody);
    }
    if (type == ";") return cont(classBody);
    if (type == "}") return cont();
  }
  function classGetterSetter(type) {
    if (type != "variable") return pass();
    cx.marked = "property";
    return cont();
  }
  function afterModule(type, value) {
    if (type == "string") return cont(statement);
    if (type == "variable") { register(value); return cont(maybeFrom); }
  }
  function afterExport(_type, value) {
    if (value == "*") { cx.marked = "keyword"; return cont(maybeFrom, expect(";")); }
    if (value == "default") { cx.marked = "keyword"; return cont(expression, expect(";")); }
    return pass(statement);
  }
  function afterImport(type) {
    if (type == "string") return cont();
    return pass(importSpec, maybeFrom);
  }
  function importSpec(type, value) {
    if (type == "{") return contCommasep(importSpec, "}");
    if (type == "variable") register(value);
    return cont();
  }
  function maybeFrom(_type, value) {
    if (value == "from") { cx.marked = "keyword"; return cont(expression); }
  }
  function arrayLiteral(type) {
    if (type == "]") return cont();
    return pass(expressionNoComma, maybeArrayComprehension);
  }
  function maybeArrayComprehension(type) {
    if (type == "for") return pass(comprehension, expect("]"));
    if (type == ",") return cont(commasep(maybeexpressionNoComma, "]"));
    return pass(commasep(expressionNoComma, "]"));
  }
  function comprehension(type) {
    if (type == "for") return cont(forspec, comprehension);
    if (type == "if") return cont(expression, comprehension);
  }

  function isContinuedStatement(state, textAfter) {
    return state.lastType == "operator" || state.lastType == "," ||
      isOperatorChar.test(textAfter.charAt(0)) ||
      /[,.]/.test(textAfter.charAt(0));
  }

  // Interface

  return {
    startState: function(basecolumn) {
      var state = {
        tokenize: tokenBase,
        lastType: "sof",
        cc: [],
        lexical: new JSLexical((basecolumn || 0) - indentUnit, 0, "block", false),
        localVars: parserConfig.localVars,
        context: parserConfig.localVars && {vars: parserConfig.localVars},
        indented: 0
      };
      if (parserConfig.globalVars && typeof parserConfig.globalVars == "object")
        state.globalVars = parserConfig.globalVars;
      return state;
    },

    token: function(stream, state) {
      if (stream.sol()) {
        if (!state.lexical.hasOwnProperty("align"))
          state.lexical.align = false;
        state.indented = stream.indentation();
        findFatArrow(stream, state);
      }
      if (state.tokenize != tokenComment && stream.eatSpace()) return null;
      var style = state.tokenize(stream, state);
      if (type == "comment") return style;
      state.lastType = type == "operator" && (content == "++" || content == "--") ? "incdec" : type;
      return parseJS(state, style, type, content, stream);
    },

    indent: function(state, textAfter) {
      if (state.tokenize == tokenComment) return CodeMirror.Pass;
      if (state.tokenize != tokenBase) return 0;
      var firstChar = textAfter && textAfter.charAt(0), lexical = state.lexical;
      // Kludge to prevent 'maybelse' from blocking lexical scope pops
      if (!/^\s*else\b/.test(textAfter)) for (var i = state.cc.length - 1; i >= 0; --i) {
        var c = state.cc[i];
        if (c == poplex) lexical = lexical.prev;
        else if (c != maybeelse) break;
      }
      if (lexical.type == "stat" && firstChar == "}") lexical = lexical.prev;
      if (statementIndent && lexical.type == ")" && lexical.prev.type == "stat")
        lexical = lexical.prev;
      var type = lexical.type, closing = firstChar == type;

      if (type == "vardef") return lexical.indented + (state.lastType == "operator" || state.lastType == "," ? lexical.info + 1 : 0);
      else if (type == "form" && firstChar == "{") return lexical.indented;
      else if (type == "form") return lexical.indented + indentUnit;
      else if (type == "stat")
        return lexical.indented + (isContinuedStatement(state, textAfter) ? statementIndent || indentUnit : 0);
      else if (lexical.info == "switch" && !closing && parserConfig.doubleIndentSwitch != false)
        return lexical.indented + (/^(?:case|default)\b/.test(textAfter) ? indentUnit : 2 * indentUnit);
      else if (lexical.align) return lexical.column + (closing ? 0 : 1);
      else return lexical.indented + (closing ? 0 : indentUnit);
    },

    electricInput: /^\s*(?:case .*?:|default:|\{|\})$/,
    blockCommentStart: jsonMode ? null : "/*",
    blockCommentEnd: jsonMode ? null : "*/",
    lineComment: jsonMode ? null : "//",
    fold: "brace",

    helperType: jsonMode ? "json" : "javascript",
    jsonldMode: jsonldMode,
    jsonMode: jsonMode
  };
});

CodeMirror.registerHelper("wordChars", "javascript", /[\w$]/);

CodeMirror.defineMIME("text/javascript", "javascript");
CodeMirror.defineMIME("text/ecmascript", "javascript");
CodeMirror.defineMIME("application/javascript", "javascript");
CodeMirror.defineMIME("application/x-javascript", "javascript");
CodeMirror.defineMIME("application/ecmascript", "javascript");
CodeMirror.defineMIME("application/json", {name: "javascript", json: true});
CodeMirror.defineMIME("application/x-json", {name: "javascript", json: true});
CodeMirror.defineMIME("application/ld+json", {name: "javascript", jsonld: true});
CodeMirror.defineMIME("text/typescript", { name: "javascript", typescript: true });
CodeMirror.defineMIME("application/typescript", { name: "javascript", typescript: true });

});

/*!
 * VERSION: 1.15.0
 * DATE: 2014-12-03
 * UPDATES AND DOCS AT: http://www.greensock.com
 * 
 * Includes all of the following: TweenLite, TweenMax, TimelineLite, TimelineMax, EasePack, CSSPlugin, RoundPropsPlugin, BezierPlugin, AttrPlugin, DirectionalRotationPlugin
 *
 * @license Copyright (c) 2008-2014, GreenSock. All rights reserved.
 * This work is subject to the terms at http://www.greensock.com/terms_of_use.html or for
 * Club GreenSock members, the software agreement that was issued with your membership.
 * 
 * @author: Jack Doyle, jack@greensock.com
 **/
var _gsScope = (typeof(module) !== "undefined" && module.exports && typeof(global) !== "undefined") ? global : this || window; //helps ensure compatibility with AMD/RequireJS and CommonJS/Node
(_gsScope._gsQueue || (_gsScope._gsQueue = [])).push( function() {

	"use strict";

	_gsScope._gsDefine("TweenMax", ["core.Animation","core.SimpleTimeline","TweenLite"], function(Animation, SimpleTimeline, TweenLite) {

		var _slice = function(a) { //don't use [].slice because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
				var b = [],
					l = a.length,
					i;
				for (i = 0; i !== l; b.push(a[i++]));
				return b;
			},
			TweenMax = function(target, duration, vars) {
				TweenLite.call(this, target, duration, vars);
				this._cycle = 0;
				this._yoyo = (this.vars.yoyo === true);
				this._repeat = this.vars.repeat || 0;
				this._repeatDelay = this.vars.repeatDelay || 0;
				this._dirty = true; //ensures that if there is any repeat, the totalDuration will get recalculated to accurately report it.
				this.render = TweenMax.prototype.render; //speed optimization (avoid prototype lookup on this "hot" method)
			},
			_tinyNum = 0.0000000001,
			TweenLiteInternals = TweenLite._internals,
			_isSelector = TweenLiteInternals.isSelector,
			_isArray = TweenLiteInternals.isArray,
			p = TweenMax.prototype = TweenLite.to({}, 0.1, {}),
			_blankArray = [];

		TweenMax.version = "1.15.0";
		p.constructor = TweenMax;
		p.kill()._gc = false;
		TweenMax.killTweensOf = TweenMax.killDelayedCallsTo = TweenLite.killTweensOf;
		TweenMax.getTweensOf = TweenLite.getTweensOf;
		TweenMax.lagSmoothing = TweenLite.lagSmoothing;
		TweenMax.ticker = TweenLite.ticker;
		TweenMax.render = TweenLite.render;

		p.invalidate = function() {
			this._yoyo = (this.vars.yoyo === true);
			this._repeat = this.vars.repeat || 0;
			this._repeatDelay = this.vars.repeatDelay || 0;
			this._uncache(true);
			return TweenLite.prototype.invalidate.call(this);
		};
		
		p.updateTo = function(vars, resetDuration) {
			var curRatio = this.ratio,
				immediate = this.vars.immediateRender || vars.immediateRender,
				p;
			if (resetDuration && this._startTime < this._timeline._time) {
				this._startTime = this._timeline._time;
				this._uncache(false);
				if (this._gc) {
					this._enabled(true, false);
				} else {
					this._timeline.insert(this, this._startTime - this._delay); //ensures that any necessary re-sequencing of Animations in the timeline occurs to make sure the rendering order is correct.
				}
			}
			for (p in vars) {
				this.vars[p] = vars[p];
			}
			if (this._initted || immediate) {
				if (resetDuration) {
					this._initted = false;
					if (immediate) {
						this.render(0, true, true);
					}
				} else {
					if (this._gc) {
						this._enabled(true, false);
					}
					if (this._notifyPluginsOfEnabled && this._firstPT) {
						TweenLite._onPluginEvent("_onDisable", this); //in case a plugin like MotionBlur must perform some cleanup tasks
					}
					if (this._time / this._duration > 0.998) { //if the tween has finished (or come extremely close to finishing), we just need to rewind it to 0 and then render it again at the end which forces it to re-initialize (parsing the new vars). We allow tweens that are close to finishing (but haven't quite finished) to work this way too because otherwise, the values are so small when determining where to project the starting values that binary math issues creep in and can make the tween appear to render incorrectly when run backwards. 
						var prevTime = this._time;
						this.render(0, true, false);
						this._initted = false;
						this.render(prevTime, true, false);
					} else if (this._time > 0 || immediate) {
						this._initted = false;
						this._init();
						var inv = 1 / (1 - curRatio),
							pt = this._firstPT, endValue;
						while (pt) {
							endValue = pt.s + pt.c; 
							pt.c *= inv;
							pt.s = endValue - pt.c;
							pt = pt._next;
						}
					}
				}
			}
			return this;
		};
				
		p.render = function(time, suppressEvents, force) {
			if (!this._initted) if (this._duration === 0 && this.vars.repeat) { //zero duration tweens that render immediately have render() called from TweenLite's constructor, before TweenMax's constructor has finished setting _repeat, _repeatDelay, and _yoyo which are critical in determining totalDuration() so we need to call invalidate() which is a low-kb way to get those set properly.
				this.invalidate();
			}
			var totalDur = (!this._dirty) ? this._totalDuration : this.totalDuration(),
				prevTime = this._time,
				prevTotalTime = this._totalTime, 
				prevCycle = this._cycle,
				duration = this._duration,
				prevRawPrevTime = this._rawPrevTime,
				isComplete, callback, pt, cycleDuration, r, type, pow, rawPrevTime, i;
			if (time >= totalDur) {
				this._totalTime = totalDur;
				this._cycle = this._repeat;
				if (this._yoyo && (this._cycle & 1) !== 0) {
					this._time = 0;
					this.ratio = this._ease._calcEnd ? this._ease.getRatio(0) : 0;
				} else {
					this._time = duration;
					this.ratio = this._ease._calcEnd ? this._ease.getRatio(1) : 1;
				}
				if (!this._reversed) {
					isComplete = true;
					callback = "onComplete";
				}
				if (duration === 0) if (this._initted || !this.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
					if (this._startTime === this._timeline._duration) { //if a zero-duration tween is at the VERY end of a timeline and that timeline renders at its end, it will typically add a tiny bit of cushion to the render time to prevent rounding errors from getting in the way of tweens rendering their VERY end. If we then reverse() that timeline, the zero-duration tween will trigger its onReverseComplete even though technically the playhead didn't pass over it again. It's a very specific edge case we must accommodate.
						time = 0;
					}
					if (time === 0 || prevRawPrevTime < 0 || prevRawPrevTime === _tinyNum) if (prevRawPrevTime !== time) {
						force = true;
						if (prevRawPrevTime > _tinyNum) {
							callback = "onReverseComplete";
						}
					}
					this._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
				}
				
			} else if (time < 0.0000001) { //to work around occasional floating point math artifacts, round super small values to 0.
				this._totalTime = this._time = this._cycle = 0;
				this.ratio = this._ease._calcEnd ? this._ease.getRatio(0) : 0;
				if (prevTotalTime !== 0 || (duration === 0 && prevRawPrevTime > 0 && prevRawPrevTime !== _tinyNum)) {
					callback = "onReverseComplete";
					isComplete = this._reversed;
				}
				if (time < 0) {
					this._active = false;
					if (duration === 0) if (this._initted || !this.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
						if (prevRawPrevTime >= 0) {
							force = true;
						}
						this._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
					}
				}
				if (!this._initted) { //if we render the very beginning (time == 0) of a fromTo(), we must force the render (normal tweens wouldn't need to render at a time of 0 when the prevTime was also 0). This is also mandatory to make sure overwriting kicks in immediately.
					force = true;
				}
			} else {
				this._totalTime = this._time = time;
				
				if (this._repeat !== 0) {
					cycleDuration = duration + this._repeatDelay;
					this._cycle = (this._totalTime / cycleDuration) >> 0; //originally _totalTime % cycleDuration but floating point errors caused problems, so I normalized it. (4 % 0.8 should be 0 but Flash reports it as 0.79999999!)
					if (this._cycle !== 0) if (this._cycle === this._totalTime / cycleDuration) {
						this._cycle--; //otherwise when rendered exactly at the end time, it will act as though it is repeating (at the beginning)
					}
					this._time = this._totalTime - (this._cycle * cycleDuration);
					if (this._yoyo) if ((this._cycle & 1) !== 0) {
						this._time = duration - this._time;
					}
					if (this._time > duration) {
						this._time = duration;
					} else if (this._time < 0) {
						this._time = 0;
					}
				}

				if (this._easeType) {
					r = this._time / duration;
					type = this._easeType;
					pow = this._easePower;
					if (type === 1 || (type === 3 && r >= 0.5)) {
						r = 1 - r;
					}
					if (type === 3) {
						r *= 2;
					}
					if (pow === 1) {
						r *= r;
					} else if (pow === 2) {
						r *= r * r;
					} else if (pow === 3) {
						r *= r * r * r;
					} else if (pow === 4) {
						r *= r * r * r * r;
					}

					if (type === 1) {
						this.ratio = 1 - r;
					} else if (type === 2) {
						this.ratio = r;
					} else if (this._time / duration < 0.5) {
						this.ratio = r / 2;
					} else {
						this.ratio = 1 - (r / 2);
					}

				} else {
					this.ratio = this._ease.getRatio(this._time / duration);
				}
				
			}
				
			if (prevTime === this._time && !force && prevCycle === this._cycle) {
				if (prevTotalTime !== this._totalTime) if (this._onUpdate) if (!suppressEvents) { //so that onUpdate fires even during the repeatDelay - as long as the totalTime changed, we should trigger onUpdate.
					this._onUpdate.apply(this.vars.onUpdateScope || this, this.vars.onUpdateParams || _blankArray);
				}
				return;
			} else if (!this._initted) {
				this._init();
				if (!this._initted || this._gc) { //immediateRender tweens typically won't initialize until the playhead advances (_time is greater than 0) in order to ensure that overwriting occurs properly. Also, if all of the tweening properties have been overwritten (which would cause _gc to be true, as set in _init()), we shouldn't continue otherwise an onStart callback could be called for example.
					return;
				} else if (!force && this._firstPT && ((this.vars.lazy !== false && this._duration) || (this.vars.lazy && !this._duration))) { //we stick it in the queue for rendering at the very end of the tick - this is a performance optimization because browsers invalidate styles and force a recalculation if you read, write, and then read style data (so it's better to read/read/read/write/write/write than read/write/read/write/read/write). The down side, of course, is that usually you WANT things to render immediately because you may have code running right after that which depends on the change. Like imagine running TweenLite.set(...) and then immediately after that, creating a nother tween that animates the same property to another value; the starting values of that 2nd tween wouldn't be accurate if lazy is true.
					this._time = prevTime;
					this._totalTime = prevTotalTime;
					this._rawPrevTime = prevRawPrevTime;
					this._cycle = prevCycle;
					TweenLiteInternals.lazyTweens.push(this);
					this._lazy = [time, suppressEvents];
					return;
				}
				//_ease is initially set to defaultEase, so now that init() has run, _ease is set properly and we need to recalculate the ratio. Overall this is faster than using conditional logic earlier in the method to avoid having to set ratio twice because we only init() once but renderTime() gets called VERY frequently.
				if (this._time && !isComplete) {
					this.ratio = this._ease.getRatio(this._time / duration);
				} else if (isComplete && this._ease._calcEnd) {
					this.ratio = this._ease.getRatio((this._time === 0) ? 0 : 1);
				}
			}
			if (this._lazy !== false) {
				this._lazy = false;
			}

			if (!this._active) if (!this._paused && this._time !== prevTime && time >= 0) {
				this._active = true; //so that if the user renders a tween (as opposed to the timeline rendering it), the timeline is forced to re-render and align it with the proper time/frame on the next rendering cycle. Maybe the tween already finished but the user manually re-renders it as halfway done.
			}
			if (prevTotalTime === 0) {
				if (this._initted === 2 && time > 0) {
					//this.invalidate();
					this._init(); //will just apply overwriting since _initted of (2) means it was a from() tween that had immediateRender:true
				}
				if (this._startAt) {
					if (time >= 0) {
						this._startAt.render(time, suppressEvents, force);
					} else if (!callback) {
						callback = "_dummyGS"; //if no callback is defined, use a dummy value just so that the condition at the end evaluates as true because _startAt should render AFTER the normal render loop when the time is negative. We could handle this in a more intuitive way, of course, but the render loop is the MOST important thing to optimize, so this technique allows us to avoid adding extra conditional logic in a high-frequency area.
					}
				}
				if (this.vars.onStart) if (this._totalTime !== 0 || duration === 0) if (!suppressEvents) {
					this.vars.onStart.apply(this.vars.onStartScope || this, this.vars.onStartParams || _blankArray);
				}
			}
			
			pt = this._firstPT;
			while (pt) {
				if (pt.f) {
					pt.t[pt.p](pt.c * this.ratio + pt.s);
				} else {
					pt.t[pt.p] = pt.c * this.ratio + pt.s;
				}
				pt = pt._next;
			}
			
			if (this._onUpdate) {
				if (time < 0) if (this._startAt && this._startTime) { //if the tween is positioned at the VERY beginning (_startTime 0) of its parent timeline, it's illegal for the playhead to go back further, so we should not render the recorded startAt values.
					this._startAt.render(time, suppressEvents, force); //note: for performance reasons, we tuck this conditional logic inside less traveled areas (most tweens don't have an onUpdate). We'd just have it at the end before the onComplete, but the values should be updated before any onUpdate is called, so we ALSO put it here and then if it's not called, we do so later near the onComplete.
				}
				if (!suppressEvents) if (this._totalTime !== prevTotalTime || isComplete) {
					this._onUpdate.apply(this.vars.onUpdateScope || this, this.vars.onUpdateParams || _blankArray);
				}
			}
			if (this._cycle !== prevCycle) if (!suppressEvents) if (!this._gc) if (this.vars.onRepeat) {
				this.vars.onRepeat.apply(this.vars.onRepeatScope || this, this.vars.onRepeatParams || _blankArray);
			}
			if (callback) if (!this._gc || force) { //check gc because there's a chance that kill() could be called in an onUpdate
				if (time < 0 && this._startAt && !this._onUpdate && this._startTime) { //if the tween is positioned at the VERY beginning (_startTime 0) of its parent timeline, it's illegal for the playhead to go back further, so we should not render the recorded startAt values.
					this._startAt.render(time, suppressEvents, force);
				}
				if (isComplete) {
					if (this._timeline.autoRemoveChildren) {
						this._enabled(false, false);
					}
					this._active = false;
				}
				if (!suppressEvents && this.vars[callback]) {
					this.vars[callback].apply(this.vars[callback + "Scope"] || this, this.vars[callback + "Params"] || _blankArray);
				}
				if (duration === 0 && this._rawPrevTime === _tinyNum && rawPrevTime !== _tinyNum) { //the onComplete or onReverseComplete could trigger movement of the playhead and for zero-duration tweens (which must discern direction) that land directly back on their start time, we don't want to fire again on the next render. Think of several addPause()'s in a timeline that forces the playhead to a certain spot, but what if it's already paused and another tween is tweening the "time" of the timeline? Each time it moves [forward] past that spot, it would move back, and since suppressEvents is true, it'd reset _rawPrevTime to _tinyNum so that when it begins again, the callback would fire (so ultimately it could bounce back and forth during that tween). Again, this is a very uncommon scenario, but possible nonetheless.
					this._rawPrevTime = 0;
				}
			}
		};
		
//---- STATIC FUNCTIONS -----------------------------------------------------------------------------------------------------------
		
		TweenMax.to = function(target, duration, vars) {
			return new TweenMax(target, duration, vars);
		};
		
		TweenMax.from = function(target, duration, vars) {
			vars.runBackwards = true;
			vars.immediateRender = (vars.immediateRender != false);
			return new TweenMax(target, duration, vars);
		};
		
		TweenMax.fromTo = function(target, duration, fromVars, toVars) {
			toVars.startAt = fromVars;
			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
			return new TweenMax(target, duration, toVars);
		};
		
		TweenMax.staggerTo = TweenMax.allTo = function(targets, duration, vars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
			stagger = stagger || 0;
			var delay = vars.delay || 0,
				a = [],
				finalComplete = function() {
					if (vars.onComplete) {
						vars.onComplete.apply(vars.onCompleteScope || this, arguments);
					}
					onCompleteAll.apply(onCompleteAllScope || this, onCompleteAllParams || _blankArray);
				},
				l, copy, i, p;
			if (!_isArray(targets)) {
				if (typeof(targets) === "string") {
					targets = TweenLite.selector(targets) || targets;
				}
				if (_isSelector(targets)) {
					targets = _slice(targets);
				}
			}
			targets = targets || [];
			if (stagger < 0) {
				targets = _slice(targets);
				targets.reverse();
				stagger *= -1;
			}
			l = targets.length - 1;
			for (i = 0; i <= l; i++) {
				copy = {};
				for (p in vars) {
					copy[p] = vars[p];
				}
				copy.delay = delay;
				if (i === l && onCompleteAll) {
					copy.onComplete = finalComplete;
				}
				a[i] = new TweenMax(targets[i], duration, copy);
				delay += stagger;
			}
			return a;
		};
		
		TweenMax.staggerFrom = TweenMax.allFrom = function(targets, duration, vars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
			vars.runBackwards = true;
			vars.immediateRender = (vars.immediateRender != false);
			return TweenMax.staggerTo(targets, duration, vars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope);
		};
		
		TweenMax.staggerFromTo = TweenMax.allFromTo = function(targets, duration, fromVars, toVars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
			toVars.startAt = fromVars;
			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
			return TweenMax.staggerTo(targets, duration, toVars, stagger, onCompleteAll, onCompleteAllParams, onCompleteAllScope);
		};
				
		TweenMax.delayedCall = function(delay, callback, params, scope, useFrames) {
			return new TweenMax(callback, 0, {delay:delay, onComplete:callback, onCompleteParams:params, onCompleteScope:scope, onReverseComplete:callback, onReverseCompleteParams:params, onReverseCompleteScope:scope, immediateRender:false, useFrames:useFrames, overwrite:0});
		};
		
		TweenMax.set = function(target, vars) {
			return new TweenMax(target, 0, vars);
		};
		
		TweenMax.isTweening = function(target) {
			return (TweenLite.getTweensOf(target, true).length > 0);
		};
		
		var _getChildrenOf = function(timeline, includeTimelines) {
				var a = [],
					cnt = 0,
					tween = timeline._first;
				while (tween) {
					if (tween instanceof TweenLite) {
						a[cnt++] = tween;
					} else {
						if (includeTimelines) {
							a[cnt++] = tween;
						}
						a = a.concat(_getChildrenOf(tween, includeTimelines));
						cnt = a.length;
					}
					tween = tween._next;
				}
				return a;
			}, 
			getAllTweens = TweenMax.getAllTweens = function(includeTimelines) {
				return _getChildrenOf(Animation._rootTimeline, includeTimelines).concat( _getChildrenOf(Animation._rootFramesTimeline, includeTimelines) );
			};
		
		TweenMax.killAll = function(complete, tweens, delayedCalls, timelines) {
			if (tweens == null) {
				tweens = true;
			}
			if (delayedCalls == null) {
				delayedCalls = true;
			}
			var a = getAllTweens((timelines != false)),
				l = a.length,
				allTrue = (tweens && delayedCalls && timelines),
				isDC, tween, i;
			for (i = 0; i < l; i++) {
				tween = a[i];
				if (allTrue || (tween instanceof SimpleTimeline) || ((isDC = (tween.target === tween.vars.onComplete)) && delayedCalls) || (tweens && !isDC)) {
					if (complete) {
						tween.totalTime(tween._reversed ? 0 : tween.totalDuration());
					} else {
						tween._enabled(false, false);
					}
				}
			}
		};
		
		TweenMax.killChildTweensOf = function(parent, complete) {
			if (parent == null) {
				return;
			}
			var tl = TweenLiteInternals.tweenLookup,
				a, curParent, p, i, l;
			if (typeof(parent) === "string") {
				parent = TweenLite.selector(parent) || parent;
			}
			if (_isSelector(parent)) {
				parent = _slice(parent);
			}
			if (_isArray(parent)) {
				i = parent.length;
				while (--i > -1) {
					TweenMax.killChildTweensOf(parent[i], complete);
				}
				return;
			}
			a = [];
			for (p in tl) {
				curParent = tl[p].target.parentNode;
				while (curParent) {
					if (curParent === parent) {
						a = a.concat(tl[p].tweens);
					}
					curParent = curParent.parentNode;
				}
			}
			l = a.length;
			for (i = 0; i < l; i++) {
				if (complete) {
					a[i].totalTime(a[i].totalDuration());
				}
				a[i]._enabled(false, false);
			}
		};

		var _changePause = function(pause, tweens, delayedCalls, timelines) {
			tweens = (tweens !== false);
			delayedCalls = (delayedCalls !== false);
			timelines = (timelines !== false);
			var a = getAllTweens(timelines),
				allTrue = (tweens && delayedCalls && timelines),
				i = a.length,
				isDC, tween;
			while (--i > -1) {
				tween = a[i];
				if (allTrue || (tween instanceof SimpleTimeline) || ((isDC = (tween.target === tween.vars.onComplete)) && delayedCalls) || (tweens && !isDC)) {
					tween.paused(pause);
				}
			}
		};
		
		TweenMax.pauseAll = function(tweens, delayedCalls, timelines) {
			_changePause(true, tweens, delayedCalls, timelines);
		};
		
		TweenMax.resumeAll = function(tweens, delayedCalls, timelines) {
			_changePause(false, tweens, delayedCalls, timelines);
		};

		TweenMax.globalTimeScale = function(value) {
			var tl = Animation._rootTimeline,
				t = TweenLite.ticker.time;
			if (!arguments.length) {
				return tl._timeScale;
			}
			value = value || _tinyNum; //can't allow zero because it'll throw the math off
			tl._startTime = t - ((t - tl._startTime) * tl._timeScale / value);
			tl = Animation._rootFramesTimeline;
			t = TweenLite.ticker.frame;
			tl._startTime = t - ((t - tl._startTime) * tl._timeScale / value);
			tl._timeScale = Animation._rootTimeline._timeScale = value;
			return value;
		};
		
	
//---- GETTERS / SETTERS ----------------------------------------------------------------------------------------------------------
		
		p.progress = function(value) {
			return (!arguments.length) ? this._time / this.duration() : this.totalTime( this.duration() * ((this._yoyo && (this._cycle & 1) !== 0) ? 1 - value : value) + (this._cycle * (this._duration + this._repeatDelay)), false);
		};
		
		p.totalProgress = function(value) {
			return (!arguments.length) ? this._totalTime / this.totalDuration() : this.totalTime( this.totalDuration() * value, false);
		};
		
		p.time = function(value, suppressEvents) {
			if (!arguments.length) {
				return this._time;
			}
			if (this._dirty) {
				this.totalDuration();
			}
			if (value > this._duration) {
				value = this._duration;
			}
			if (this._yoyo && (this._cycle & 1) !== 0) {
				value = (this._duration - value) + (this._cycle * (this._duration + this._repeatDelay));
			} else if (this._repeat !== 0) {
				value += this._cycle * (this._duration + this._repeatDelay);
			}
			return this.totalTime(value, suppressEvents);
		};

		p.duration = function(value) {
			if (!arguments.length) {
				return this._duration; //don't set _dirty = false because there could be repeats that haven't been factored into the _totalDuration yet. Otherwise, if you create a repeated TweenMax and then immediately check its duration(), it would cache the value and the totalDuration would not be correct, thus repeats wouldn't take effect.
			}
			return Animation.prototype.duration.call(this, value);
		};

		p.totalDuration = function(value) {
			if (!arguments.length) {
				if (this._dirty) {
					//instead of Infinity, we use 999999999999 so that we can accommodate reverses
					this._totalDuration = (this._repeat === -1) ? 999999999999 : this._duration * (this._repeat + 1) + (this._repeatDelay * this._repeat);
					this._dirty = false;
				}
				return this._totalDuration;
			}
			return (this._repeat === -1) ? this : this.duration( (value - (this._repeat * this._repeatDelay)) / (this._repeat + 1) );
		};
		
		p.repeat = function(value) {
			if (!arguments.length) {
				return this._repeat;
			}
			this._repeat = value;
			return this._uncache(true);
		};
		
		p.repeatDelay = function(value) {
			if (!arguments.length) {
				return this._repeatDelay;
			}
			this._repeatDelay = value;
			return this._uncache(true);
		};
		
		p.yoyo = function(value) {
			if (!arguments.length) {
				return this._yoyo;
			}
			this._yoyo = value;
			return this;
		};
		
		
		return TweenMax;
		
	}, true);








/*
 * ----------------------------------------------------------------
 * TimelineLite
 * ----------------------------------------------------------------
 */
	_gsScope._gsDefine("TimelineLite", ["core.Animation","core.SimpleTimeline","TweenLite"], function(Animation, SimpleTimeline, TweenLite) {

		var TimelineLite = function(vars) {
				SimpleTimeline.call(this, vars);
				this._labels = {};
				this.autoRemoveChildren = (this.vars.autoRemoveChildren === true);
				this.smoothChildTiming = (this.vars.smoothChildTiming === true);
				this._sortChildren = true;
				this._onUpdate = this.vars.onUpdate;
				var v = this.vars,
					val, p;
				for (p in v) {
					val = v[p];
					if (_isArray(val)) if (val.join("").indexOf("{self}") !== -1) {
						v[p] = this._swapSelfInParams(val);
					}
				}
				if (_isArray(v.tweens)) {
					this.add(v.tweens, 0, v.align, v.stagger);
				}
			},
			_tinyNum = 0.0000000001,
			TweenLiteInternals = TweenLite._internals,
			_isSelector = TweenLiteInternals.isSelector,
			_isArray = TweenLiteInternals.isArray,
			_lazyTweens = TweenLiteInternals.lazyTweens,
			_lazyRender = TweenLiteInternals.lazyRender,
			_blankArray = [],
			_globals = _gsScope._gsDefine.globals,
			_copy = function(vars) {
				var copy = {}, p;
				for (p in vars) {
					copy[p] = vars[p];
				}
				return copy;
			},
			_pauseCallback = function(tween, callback, params, scope) {
				var tl = tween._timeline,
					time = tl._totalTime;
				if ((callback || !this._forcingPlayhead) && tl._rawPrevTime !== tween._startTime) { //if the user calls a method that moves the playhead (like progress() or time()), it should honor that and skip any pauses (although if there's a callback positioned at that pause, it must jump there and make the call to ensure the time is EXACTLY what it is supposed to be, and then proceed to where the playhead is being forced). Otherwise, imagine placing a pause in the middle of a timeline and then doing timeline.progress(0.9) - it would get stuck where the pause is.
					tl.pause(tween._startTime);
					if (callback) {
						callback.apply(scope || tl, params || _blankArray);
					}
					if (this._forcingPlayhead) {
						tl.seek(time);
					}
				}
			},
			_slice = function(a) { //don't use [].slice because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
				var b = [],
					l = a.length,
					i;
				for (i = 0; i !== l; b.push(a[i++]));
				return b;
			},
			p = TimelineLite.prototype = new SimpleTimeline();

		TimelineLite.version = "1.15.0";
		p.constructor = TimelineLite;
		p.kill()._gc = p._forcingPlayhead = false;

		/* might use later...
		//translates a local time inside an animation to the corresponding time on the root/global timeline, factoring in all nesting and timeScales.
		function localToGlobal(time, animation) {
			while (animation) {
				time = (time / animation._timeScale) + animation._startTime;
				animation = animation.timeline;
			}
			return time;
		}

		//translates the supplied time on the root/global timeline into the corresponding local time inside a particular animation, factoring in all nesting and timeScales
		function globalToLocal(time, animation) {
			var scale = 1;
			time -= localToGlobal(0, animation);
			while (animation) {
				scale *= animation._timeScale;
				animation = animation.timeline;
			}
			return time * scale;
		}
		*/

		p.to = function(target, duration, vars, position) {
			var Engine = (vars.repeat && _globals.TweenMax) || TweenLite;
			return duration ? this.add( new Engine(target, duration, vars), position) : this.set(target, vars, position);
		};

		p.from = function(target, duration, vars, position) {
			return this.add( ((vars.repeat && _globals.TweenMax) || TweenLite).from(target, duration, vars), position);
		};

		p.fromTo = function(target, duration, fromVars, toVars, position) {
			var Engine = (toVars.repeat && _globals.TweenMax) || TweenLite;
			return duration ? this.add( Engine.fromTo(target, duration, fromVars, toVars), position) : this.set(target, toVars, position);
		};

		p.staggerTo = function(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
			var tl = new TimelineLite({onComplete:onCompleteAll, onCompleteParams:onCompleteAllParams, onCompleteScope:onCompleteAllScope, smoothChildTiming:this.smoothChildTiming}),
				i;
			if (typeof(targets) === "string") {
				targets = TweenLite.selector(targets) || targets;
			}
			targets = targets || [];
			if (_isSelector(targets)) { //senses if the targets object is a selector. If it is, we should translate it into an array.
				targets = _slice(targets);
			}
			stagger = stagger || 0;
			if (stagger < 0) {
				targets = _slice(targets);
				targets.reverse();
				stagger *= -1;
			}
			for (i = 0; i < targets.length; i++) {
				if (vars.startAt) {
					vars.startAt = _copy(vars.startAt);
				}
				tl.to(targets[i], duration, _copy(vars), i * stagger);
			}
			return this.add(tl, position);
		};

		p.staggerFrom = function(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
			vars.immediateRender = (vars.immediateRender != false);
			vars.runBackwards = true;
			return this.staggerTo(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams, onCompleteAllScope);
		};

		p.staggerFromTo = function(targets, duration, fromVars, toVars, stagger, position, onCompleteAll, onCompleteAllParams, onCompleteAllScope) {
			toVars.startAt = fromVars;
			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
			return this.staggerTo(targets, duration, toVars, stagger, position, onCompleteAll, onCompleteAllParams, onCompleteAllScope);
		};

		p.call = function(callback, params, scope, position) {
			return this.add( TweenLite.delayedCall(0, callback, params, scope), position);
		};

		p.set = function(target, vars, position) {
			position = this._parseTimeOrLabel(position, 0, true);
			if (vars.immediateRender == null) {
				vars.immediateRender = (position === this._time && !this._paused);
			}
			return this.add( new TweenLite(target, 0, vars), position);
		};

		TimelineLite.exportRoot = function(vars, ignoreDelayedCalls) {
			vars = vars || {};
			if (vars.smoothChildTiming == null) {
				vars.smoothChildTiming = true;
			}
			var tl = new TimelineLite(vars),
				root = tl._timeline,
				tween, next;
			if (ignoreDelayedCalls == null) {
				ignoreDelayedCalls = true;
			}
			root._remove(tl, true);
			tl._startTime = 0;
			tl._rawPrevTime = tl._time = tl._totalTime = root._time;
			tween = root._first;
			while (tween) {
				next = tween._next;
				if (!ignoreDelayedCalls || !(tween instanceof TweenLite && tween.target === tween.vars.onComplete)) {
					tl.add(tween, tween._startTime - tween._delay);
				}
				tween = next;
			}
			root.add(tl, 0);
			return tl;
		};

		p.add = function(value, position, align, stagger) {
			var curTime, l, i, child, tl, beforeRawTime;
			if (typeof(position) !== "number") {
				position = this._parseTimeOrLabel(position, 0, true, value);
			}
			if (!(value instanceof Animation)) {
				if ((value instanceof Array) || (value && value.push && _isArray(value))) {
					align = align || "normal";
					stagger = stagger || 0;
					curTime = position;
					l = value.length;
					for (i = 0; i < l; i++) {
						if (_isArray(child = value[i])) {
							child = new TimelineLite({tweens:child});
						}
						this.add(child, curTime);
						if (typeof(child) !== "string" && typeof(child) !== "function") {
							if (align === "sequence") {
								curTime = child._startTime + (child.totalDuration() / child._timeScale);
							} else if (align === "start") {
								child._startTime -= child.delay();
							}
						}
						curTime += stagger;
					}
					return this._uncache(true);
				} else if (typeof(value) === "string") {
					return this.addLabel(value, position);
				} else if (typeof(value) === "function") {
					value = TweenLite.delayedCall(0, value);
				} else {
					throw("Cannot add " + value + " into the timeline; it is not a tween, timeline, function, or string.");
				}
			}

			SimpleTimeline.prototype.add.call(this, value, position);

			//if the timeline has already ended but the inserted tween/timeline extends the duration, we should enable this timeline again so that it renders properly. We should also align the playhead with the parent timeline's when appropriate.
			if (this._gc || this._time === this._duration) if (!this._paused) if (this._duration < this.duration()) {
				//in case any of the ancestors had completed but should now be enabled...
				tl = this;
				beforeRawTime = (tl.rawTime() > value._startTime); //if the tween is placed on the timeline so that it starts BEFORE the current rawTime, we should align the playhead (move the timeline). This is because sometimes users will create a timeline, let it finish, and much later append a tween and expect it to run instead of jumping to its end state. While technically one could argue that it should jump to its end state, that's not what users intuitively expect.
				while (tl._timeline) {
					if (beforeRawTime && tl._timeline.smoothChildTiming) {
						tl.totalTime(tl._totalTime, true); //moves the timeline (shifts its startTime) if necessary, and also enables it.
					} else if (tl._gc) {
						tl._enabled(true, false);
					}
					tl = tl._timeline;
				}
			}

			return this;
		};

		p.remove = function(value) {
			if (value instanceof Animation) {
				return this._remove(value, false);
			} else if (value instanceof Array || (value && value.push && _isArray(value))) {
				var i = value.length;
				while (--i > -1) {
					this.remove(value[i]);
				}
				return this;
			} else if (typeof(value) === "string") {
				return this.removeLabel(value);
			}
			return this.kill(null, value);
		};

		p._remove = function(tween, skipDisable) {
			SimpleTimeline.prototype._remove.call(this, tween, skipDisable);
			var last = this._last;
			if (!last) {
				this._time = this._totalTime = this._duration = this._totalDuration = 0;
			} else if (this._time > last._startTime + last._totalDuration / last._timeScale) {
				this._time = this.duration();
				this._totalTime = this._totalDuration;
			}
			return this;
		};

		p.append = function(value, offsetOrLabel) {
			return this.add(value, this._parseTimeOrLabel(null, offsetOrLabel, true, value));
		};

		p.insert = p.insertMultiple = function(value, position, align, stagger) {
			return this.add(value, position || 0, align, stagger);
		};

		p.appendMultiple = function(tweens, offsetOrLabel, align, stagger) {
			return this.add(tweens, this._parseTimeOrLabel(null, offsetOrLabel, true, tweens), align, stagger);
		};

		p.addLabel = function(label, position) {
			this._labels[label] = this._parseTimeOrLabel(position);
			return this;
		};

		p.addPause = function(position, callback, params, scope) {
			var t = TweenLite.delayedCall(0, _pauseCallback, ["{self}", callback, params, scope], this);
			t.data = "isPause"; // we use this flag in TweenLite's render() method to identify it as a special case that shouldn't be triggered when the virtual playhead is LEAVING the exact position where the pause is, otherwise timeline.addPause(1).play(1) would end up paused on the very next tick.
			return this.add(t, position);
		};

		p.removeLabel = function(label) {
			delete this._labels[label];
			return this;
		};

		p.getLabelTime = function(label) {
			return (this._labels[label] != null) ? this._labels[label] : -1;
		};

		p._parseTimeOrLabel = function(timeOrLabel, offsetOrLabel, appendIfAbsent, ignore) {
			var i;
			//if we're about to add a tween/timeline (or an array of them) that's already a child of this timeline, we should remove it first so that it doesn't contaminate the duration().
			if (ignore instanceof Animation && ignore.timeline === this) {
				this.remove(ignore);
			} else if (ignore && ((ignore instanceof Array) || (ignore.push && _isArray(ignore)))) {
				i = ignore.length;
				while (--i > -1) {
					if (ignore[i] instanceof Animation && ignore[i].timeline === this) {
						this.remove(ignore[i]);
					}
				}
			}
			if (typeof(offsetOrLabel) === "string") {
				return this._parseTimeOrLabel(offsetOrLabel, (appendIfAbsent && typeof(timeOrLabel) === "number" && this._labels[offsetOrLabel] == null) ? timeOrLabel - this.duration() : 0, appendIfAbsent);
			}
			offsetOrLabel = offsetOrLabel || 0;
			if (typeof(timeOrLabel) === "string" && (isNaN(timeOrLabel) || this._labels[timeOrLabel] != null)) { //if the string is a number like "1", check to see if there's a label with that name, otherwise interpret it as a number (absolute value).
				i = timeOrLabel.indexOf("=");
				if (i === -1) {
					if (this._labels[timeOrLabel] == null) {
						return appendIfAbsent ? (this._labels[timeOrLabel] = this.duration() + offsetOrLabel) : offsetOrLabel;
					}
					return this._labels[timeOrLabel] + offsetOrLabel;
				}
				offsetOrLabel = parseInt(timeOrLabel.charAt(i-1) + "1", 10) * Number(timeOrLabel.substr(i+1));
				timeOrLabel = (i > 1) ? this._parseTimeOrLabel(timeOrLabel.substr(0, i-1), 0, appendIfAbsent) : this.duration();
			} else if (timeOrLabel == null) {
				timeOrLabel = this.duration();
			}
			return Number(timeOrLabel) + offsetOrLabel;
		};

		p.seek = function(position, suppressEvents) {
			return this.totalTime((typeof(position) === "number") ? position : this._parseTimeOrLabel(position), (suppressEvents !== false));
		};

		p.stop = function() {
			return this.paused(true);
		};

		p.gotoAndPlay = function(position, suppressEvents) {
			return this.play(position, suppressEvents);
		};

		p.gotoAndStop = function(position, suppressEvents) {
			return this.pause(position, suppressEvents);
		};

		p.render = function(time, suppressEvents, force) {
			if (this._gc) {
				this._enabled(true, false);
			}
			var totalDur = (!this._dirty) ? this._totalDuration : this.totalDuration(),
				prevTime = this._time,
				prevStart = this._startTime,
				prevTimeScale = this._timeScale,
				prevPaused = this._paused,
				tween, isComplete, next, callback, internalForce;
			if (time >= totalDur) {
				this._totalTime = this._time = totalDur;
				if (!this._reversed) if (!this._hasPausedChild()) {
					isComplete = true;
					callback = "onComplete";
					if (this._duration === 0) if (time === 0 || this._rawPrevTime < 0 || this._rawPrevTime === _tinyNum) if (this._rawPrevTime !== time && this._first) {
						internalForce = true;
						if (this._rawPrevTime > _tinyNum) {
							callback = "onReverseComplete";
						}
					}
				}
				this._rawPrevTime = (this._duration || !suppressEvents || time || this._rawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration timeline or tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
				time = totalDur + 0.0001; //to avoid occasional floating point rounding errors - sometimes child tweens/timelines were not being fully completed (their progress might be 0.999999999999998 instead of 1 because when _time - tween._startTime is performed, floating point errors would return a value that was SLIGHTLY off). Try (999999999999.7 - 999999999999) * 1 = 0.699951171875 instead of 0.7.

			} else if (time < 0.0000001) { //to work around occasional floating point math artifacts, round super small values to 0.
				this._totalTime = this._time = 0;
				if (prevTime !== 0 || (this._duration === 0 && this._rawPrevTime !== _tinyNum && (this._rawPrevTime > 0 || (time < 0 && this._rawPrevTime >= 0)))) {
					callback = "onReverseComplete";
					isComplete = this._reversed;
				}
				if (time < 0) {
					this._active = false;
					if (this._rawPrevTime >= 0 && this._first) { //when going back beyond the start, force a render so that zero-duration tweens that sit at the very beginning render their start values properly. Otherwise, if the parent timeline's playhead lands exactly at this timeline's startTime, and then moves backwards, the zero-duration tweens at the beginning would still be at their end state.
						internalForce = true;
					}
					this._rawPrevTime = time;
				} else {
					this._rawPrevTime = (this._duration || !suppressEvents || time || this._rawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration timeline or tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.

					time = 0; //to avoid occasional floating point rounding errors (could cause problems especially with zero-duration tweens at the very beginning of the timeline)
					if (!this._initted) {
						internalForce = true;
					}
				}

			} else {
				this._totalTime = this._time = this._rawPrevTime = time;
			}
			if ((this._time === prevTime || !this._first) && !force && !internalForce) {
				return;
			} else if (!this._initted) {
				this._initted = true;
			}

			if (!this._active) if (!this._paused && this._time !== prevTime && time > 0) {
				this._active = true;  //so that if the user renders the timeline (as opposed to the parent timeline rendering it), it is forced to re-render and align it with the proper time/frame on the next rendering cycle. Maybe the timeline already finished but the user manually re-renders it as halfway done, for example.
			}

			if (prevTime === 0) if (this.vars.onStart) if (this._time !== 0) if (!suppressEvents) {
				this.vars.onStart.apply(this.vars.onStartScope || this, this.vars.onStartParams || _blankArray);
			}

			if (this._time >= prevTime) {
				tween = this._first;
				while (tween) {
					next = tween._next; //record it here because the value could change after rendering...
					if (this._paused && !prevPaused) { //in case a tween pauses the timeline when rendering
						break;
					} else if (tween._active || (tween._startTime <= this._time && !tween._paused && !tween._gc)) {
						if (!tween._reversed) {
							tween.render((time - tween._startTime) * tween._timeScale, suppressEvents, force);
						} else {
							tween.render(((!tween._dirty) ? tween._totalDuration : tween.totalDuration()) - ((time - tween._startTime) * tween._timeScale), suppressEvents, force);
						}
					}
					tween = next;
				}
			} else {
				tween = this._last;
				while (tween) {
					next = tween._prev; //record it here because the value could change after rendering...
					if (this._paused && !prevPaused) { //in case a tween pauses the timeline when rendering
						break;
					} else if (tween._active || (tween._startTime <= prevTime && !tween._paused && !tween._gc)) {
						if (!tween._reversed) {
							tween.render((time - tween._startTime) * tween._timeScale, suppressEvents, force);
						} else {
							tween.render(((!tween._dirty) ? tween._totalDuration : tween.totalDuration()) - ((time - tween._startTime) * tween._timeScale), suppressEvents, force);
						}
					}
					tween = next;
				}
			}

			if (this._onUpdate) if (!suppressEvents) {
				if (_lazyTweens.length) { //in case rendering caused any tweens to lazy-init, we should render them because typically when a timeline finishes, users expect things to have rendered fully. Imagine an onUpdate on a timeline that reports/checks tweened values.
					_lazyRender();
				}
				this._onUpdate.apply(this.vars.onUpdateScope || this, this.vars.onUpdateParams || _blankArray);
			}

			if (callback) if (!this._gc) if (prevStart === this._startTime || prevTimeScale !== this._timeScale) if (this._time === 0 || totalDur >= this.totalDuration()) { //if one of the tweens that was rendered altered this timeline's startTime (like if an onComplete reversed the timeline), it probably isn't complete. If it is, don't worry, because whatever call altered the startTime would complete if it was necessary at the new time. The only exception is the timeScale property. Also check _gc because there's a chance that kill() could be called in an onUpdate
				if (isComplete) {
					if (_lazyTweens.length) { //in case rendering caused any tweens to lazy-init, we should render them because typically when a timeline finishes, users expect things to have rendered fully. Imagine an onComplete on a timeline that reports/checks tweened values.
						_lazyRender();
					}
					if (this._timeline.autoRemoveChildren) {
						this._enabled(false, false);
					}
					this._active = false;
				}
				if (!suppressEvents && this.vars[callback]) {
					this.vars[callback].apply(this.vars[callback + "Scope"] || this, this.vars[callback + "Params"] || _blankArray);
				}
			}
		};

		p._hasPausedChild = function() {
			var tween = this._first;
			while (tween) {
				if (tween._paused || ((tween instanceof TimelineLite) && tween._hasPausedChild())) {
					return true;
				}
				tween = tween._next;
			}
			return false;
		};

		p.getChildren = function(nested, tweens, timelines, ignoreBeforeTime) {
			ignoreBeforeTime = ignoreBeforeTime || -9999999999;
			var a = [],
				tween = this._first,
				cnt = 0;
			while (tween) {
				if (tween._startTime < ignoreBeforeTime) {
					//do nothing
				} else if (tween instanceof TweenLite) {
					if (tweens !== false) {
						a[cnt++] = tween;
					}
				} else {
					if (timelines !== false) {
						a[cnt++] = tween;
					}
					if (nested !== false) {
						a = a.concat(tween.getChildren(true, tweens, timelines));
						cnt = a.length;
					}
				}
				tween = tween._next;
			}
			return a;
		};

		p.getTweensOf = function(target, nested) {
			var disabled = this._gc,
				a = [],
				cnt = 0,
				tweens, i;
			if (disabled) {
				this._enabled(true, true); //getTweensOf() filters out disabled tweens, and we have to mark them as _gc = true when the timeline completes in order to allow clean garbage collection, so temporarily re-enable the timeline here.
			}
			tweens = TweenLite.getTweensOf(target);
			i = tweens.length;
			while (--i > -1) {
				if (tweens[i].timeline === this || (nested && this._contains(tweens[i]))) {
					a[cnt++] = tweens[i];
				}
			}
			if (disabled) {
				this._enabled(false, true);
			}
			return a;
		};

		p.recent = function() {
			return this._recent;
		};

		p._contains = function(tween) {
			var tl = tween.timeline;
			while (tl) {
				if (tl === this) {
					return true;
				}
				tl = tl.timeline;
			}
			return false;
		};

		p.shiftChildren = function(amount, adjustLabels, ignoreBeforeTime) {
			ignoreBeforeTime = ignoreBeforeTime || 0;
			var tween = this._first,
				labels = this._labels,
				p;
			while (tween) {
				if (tween._startTime >= ignoreBeforeTime) {
					tween._startTime += amount;
				}
				tween = tween._next;
			}
			if (adjustLabels) {
				for (p in labels) {
					if (labels[p] >= ignoreBeforeTime) {
						labels[p] += amount;
					}
				}
			}
			return this._uncache(true);
		};

		p._kill = function(vars, target) {
			if (!vars && !target) {
				return this._enabled(false, false);
			}
			var tweens = (!target) ? this.getChildren(true, true, false) : this.getTweensOf(target),
				i = tweens.length,
				changed = false;
			while (--i > -1) {
				if (tweens[i]._kill(vars, target)) {
					changed = true;
				}
			}
			return changed;
		};

		p.clear = function(labels) {
			var tweens = this.getChildren(false, true, true),
				i = tweens.length;
			this._time = this._totalTime = 0;
			while (--i > -1) {
				tweens[i]._enabled(false, false);
			}
			if (labels !== false) {
				this._labels = {};
			}
			return this._uncache(true);
		};

		p.invalidate = function() {
			var tween = this._first;
			while (tween) {
				tween.invalidate();
				tween = tween._next;
			}
			return Animation.prototype.invalidate.call(this);;
		};

		p._enabled = function(enabled, ignoreTimeline) {
			if (enabled === this._gc) {
				var tween = this._first;
				while (tween) {
					tween._enabled(enabled, true);
					tween = tween._next;
				}
			}
			return SimpleTimeline.prototype._enabled.call(this, enabled, ignoreTimeline);
		};

		p.totalTime = function(time, suppressEvents, uncapped) {
			this._forcingPlayhead = true;
			var val = Animation.prototype.totalTime.apply(this, arguments);
			this._forcingPlayhead = false;
			return val;
		};

		p.duration = function(value) {
			if (!arguments.length) {
				if (this._dirty) {
					this.totalDuration(); //just triggers recalculation
				}
				return this._duration;
			}
			if (this.duration() !== 0 && value !== 0) {
				this.timeScale(this._duration / value);
			}
			return this;
		};

		p.totalDuration = function(value) {
			if (!arguments.length) {
				if (this._dirty) {
					var max = 0,
						tween = this._last,
						prevStart = 999999999999,
						prev, end;
					while (tween) {
						prev = tween._prev; //record it here in case the tween changes position in the sequence...
						if (tween._dirty) {
							tween.totalDuration(); //could change the tween._startTime, so make sure the tween's cache is clean before analyzing it.
						}
						if (tween._startTime > prevStart && this._sortChildren && !tween._paused) { //in case one of the tweens shifted out of order, it needs to be re-inserted into the correct position in the sequence
							this.add(tween, tween._startTime - tween._delay);
						} else {
							prevStart = tween._startTime;
						}
						if (tween._startTime < 0 && !tween._paused) { //children aren't allowed to have negative startTimes unless smoothChildTiming is true, so adjust here if one is found.
							max -= tween._startTime;
							if (this._timeline.smoothChildTiming) {
								this._startTime += tween._startTime / this._timeScale;
							}
							this.shiftChildren(-tween._startTime, false, -9999999999);
							prevStart = 0;
						}
						end = tween._startTime + (tween._totalDuration / tween._timeScale);
						if (end > max) {
							max = end;
						}
						tween = prev;
					}
					this._duration = this._totalDuration = max;
					this._dirty = false;
				}
				return this._totalDuration;
			}
			if (this.totalDuration() !== 0) if (value !== 0) {
				this.timeScale(this._totalDuration / value);
			}
			return this;
		};

		p.usesFrames = function() {
			var tl = this._timeline;
			while (tl._timeline) {
				tl = tl._timeline;
			}
			return (tl === Animation._rootFramesTimeline);
		};

		p.rawTime = function() {
			return this._paused ? this._totalTime : (this._timeline.rawTime() - this._startTime) * this._timeScale;
		};

		return TimelineLite;

	}, true);
	







	
	
	
	
	
/*
 * ----------------------------------------------------------------
 * TimelineMax
 * ----------------------------------------------------------------
 */
	_gsScope._gsDefine("TimelineMax", ["TimelineLite","TweenLite","easing.Ease"], function(TimelineLite, TweenLite, Ease) {

		var TimelineMax = function(vars) {
				TimelineLite.call(this, vars);
				this._repeat = this.vars.repeat || 0;
				this._repeatDelay = this.vars.repeatDelay || 0;
				this._cycle = 0;
				this._yoyo = (this.vars.yoyo === true);
				this._dirty = true;
			},
			_tinyNum = 0.0000000001,
			_blankArray = [],
			TweenLiteInternals = TweenLite._internals,
			_lazyTweens = TweenLiteInternals.lazyTweens,
			_lazyRender = TweenLiteInternals.lazyRender,
			_easeNone = new Ease(null, null, 1, 0),
			p = TimelineMax.prototype = new TimelineLite();

		p.constructor = TimelineMax;
		p.kill()._gc = false;
		TimelineMax.version = "1.15.0";

		p.invalidate = function() {
			this._yoyo = (this.vars.yoyo === true);
			this._repeat = this.vars.repeat || 0;
			this._repeatDelay = this.vars.repeatDelay || 0;
			this._uncache(true);
			return TimelineLite.prototype.invalidate.call(this);
		};

		p.addCallback = function(callback, position, params, scope) {
			return this.add( TweenLite.delayedCall(0, callback, params, scope), position);
		};

		p.removeCallback = function(callback, position) {
			if (callback) {
				if (position == null) {
					this._kill(null, callback);
				} else {
					var a = this.getTweensOf(callback, false),
						i = a.length,
						time = this._parseTimeOrLabel(position);
					while (--i > -1) {
						if (a[i]._startTime === time) {
							a[i]._enabled(false, false);
						}
					}
				}
			}
			return this;
		};

		p.tweenTo = function(position, vars) {
			vars = vars || {};
			var copy = {ease:_easeNone, overwrite:(vars.delay ? 2 : 1), useFrames:this.usesFrames(), immediateRender:false},//note: set overwrite to 1 (true/all) by default unless there's a delay so that we avoid a racing situation that could happen if, for example, an onmousemove creates the same tweenTo() over and over again.
				duration, p, t;
			for (p in vars) {
				copy[p] = vars[p];
			}
			copy.time = this._parseTimeOrLabel(position);
			duration = (Math.abs(Number(copy.time) - this._time) / this._timeScale) || 0.001;
			t = new TweenLite(this, duration, copy);
			copy.onStart = function() {
				t.target.paused(true);
				if (t.vars.time !== t.target.time() && duration === t.duration()) { //don't make the duration zero - if it's supposed to be zero, don't worry because it's already initting the tween and will complete immediately, effectively making the duration zero anyway. If we make duration zero, the tween won't run at all.
					t.duration( Math.abs( t.vars.time - t.target.time()) / t.target._timeScale );
				}
				if (vars.onStart) { //in case the user had an onStart in the vars - we don't want to overwrite it.
					vars.onStart.apply(vars.onStartScope || t, vars.onStartParams || _blankArray);
				}
			};
			return t;
		};

		p.tweenFromTo = function(fromPosition, toPosition, vars) {
			vars = vars || {};
			fromPosition = this._parseTimeOrLabel(fromPosition);
			vars.startAt = {onComplete:this.seek, onCompleteParams:[fromPosition], onCompleteScope:this};
			vars.immediateRender = (vars.immediateRender !== false);
			var t = this.tweenTo(toPosition, vars);
			return t.duration((Math.abs( t.vars.time - fromPosition) / this._timeScale) || 0.001);
		};

		p.render = function(time, suppressEvents, force) {
			if (this._gc) {
				this._enabled(true, false);
			}
			var totalDur = (!this._dirty) ? this._totalDuration : this.totalDuration(),
				dur = this._duration,
				prevTime = this._time,
				prevTotalTime = this._totalTime,
				prevStart = this._startTime,
				prevTimeScale = this._timeScale,
				prevRawPrevTime = this._rawPrevTime,
				prevPaused = this._paused,
				prevCycle = this._cycle,
				tween, isComplete, next, callback, internalForce, cycleDuration;
			if (time >= totalDur) {
				if (!this._locked) {
					this._totalTime = totalDur;
					this._cycle = this._repeat;
				}
				if (!this._reversed) if (!this._hasPausedChild()) {
					isComplete = true;
					callback = "onComplete";
					if (this._duration === 0) if (time === 0 || prevRawPrevTime < 0 || prevRawPrevTime === _tinyNum) if (prevRawPrevTime !== time && this._first) {
						internalForce = true;
						if (prevRawPrevTime > _tinyNum) {
							callback = "onReverseComplete";
						}
					}
				}
				this._rawPrevTime = (this._duration || !suppressEvents || time || this._rawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration timeline or tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
				if (this._yoyo && (this._cycle & 1) !== 0) {
					this._time = time = 0;
				} else {
					this._time = dur;
					time = dur + 0.0001; //to avoid occasional floating point rounding errors - sometimes child tweens/timelines were not being fully completed (their progress might be 0.999999999999998 instead of 1 because when _time - tween._startTime is performed, floating point errors would return a value that was SLIGHTLY off). Try (999999999999.7 - 999999999999) * 1 = 0.699951171875 instead of 0.7. We cannot do less then 0.0001 because the same issue can occur when the duration is extremely large like 999999999999 in which case adding 0.00000001, for example, causes it to act like nothing was added.
				}

			} else if (time < 0.0000001) { //to work around occasional floating point math artifacts, round super small values to 0.
				if (!this._locked) {
					this._totalTime = this._cycle = 0;
				}
				this._time = 0;
				if (prevTime !== 0 || (dur === 0 && prevRawPrevTime !== _tinyNum && (prevRawPrevTime > 0 || (time < 0 && prevRawPrevTime >= 0)) && !this._locked)) { //edge case for checking time < 0 && prevRawPrevTime >= 0: a zero-duration fromTo() tween inside a zero-duration timeline (yeah, very rare)
					callback = "onReverseComplete";
					isComplete = this._reversed;
				}
				if (time < 0) {
					this._active = false;
					if (prevRawPrevTime >= 0 && this._first) { //when going back beyond the start, force a render so that zero-duration tweens that sit at the very beginning render their start values properly. Otherwise, if the parent timeline's playhead lands exactly at this timeline's startTime, and then moves backwards, the zero-duration tweens at the beginning would still be at their end state.
						internalForce = true;
					}
					this._rawPrevTime = time;
				} else {
					this._rawPrevTime = (dur || !suppressEvents || time || this._rawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration timeline or tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
					time = 0; //to avoid occasional floating point rounding errors (could cause problems especially with zero-duration tweens at the very beginning of the timeline)
					if (!this._initted) {
						internalForce = true;
					}
				}

			} else {
				if (dur === 0 && prevRawPrevTime < 0) { //without this, zero-duration repeating timelines (like with a simple callback nested at the very beginning and a repeatDelay) wouldn't render the first time through.
					internalForce = true;
				}
				this._time = this._rawPrevTime = time;
				if (!this._locked) {
					this._totalTime = time;
					if (this._repeat !== 0) {
						cycleDuration = dur + this._repeatDelay;
						this._cycle = (this._totalTime / cycleDuration) >> 0; //originally _totalTime % cycleDuration but floating point errors caused problems, so I normalized it. (4 % 0.8 should be 0 but it gets reported as 0.79999999!)
						if (this._cycle !== 0) if (this._cycle === this._totalTime / cycleDuration) {
							this._cycle--; //otherwise when rendered exactly at the end time, it will act as though it is repeating (at the beginning)
						}
						this._time = this._totalTime - (this._cycle * cycleDuration);
						if (this._yoyo) if ((this._cycle & 1) !== 0) {
							this._time = dur - this._time;
						}
						if (this._time > dur) {
							this._time = dur;
							time = dur + 0.0001; //to avoid occasional floating point rounding error
						} else if (this._time < 0) {
							this._time = time = 0;
						} else {
							time = this._time;
						}
					}
				}
			}

			if (this._cycle !== prevCycle) if (!this._locked) {
				/*
				make sure children at the end/beginning of the timeline are rendered properly. If, for example,
				a 3-second long timeline rendered at 2.9 seconds previously, and now renders at 3.2 seconds (which
				would get transated to 2.8 seconds if the timeline yoyos or 0.2 seconds if it just repeats), there
				could be a callback or a short tween that's at 2.95 or 3 seconds in which wouldn't render. So
				we need to push the timeline to the end (and/or beginning depending on its yoyo value). Also we must
				ensure that zero-duration tweens at the very beginning or end of the TimelineMax work.
				*/
				var backwards = (this._yoyo && (prevCycle & 1) !== 0),
					wrap = (backwards === (this._yoyo && (this._cycle & 1) !== 0)),
					recTotalTime = this._totalTime,
					recCycle = this._cycle,
					recRawPrevTime = this._rawPrevTime,
					recTime = this._time;

				this._totalTime = prevCycle * dur;
				if (this._cycle < prevCycle) {
					backwards = !backwards;
				} else {
					this._totalTime += dur;
				}
				this._time = prevTime; //temporarily revert _time so that render() renders the children in the correct order. Without this, tweens won't rewind correctly. We could arhictect things in a "cleaner" way by splitting out the rendering queue into a separate method but for performance reasons, we kept it all inside this method.

				this._rawPrevTime = (dur === 0) ? prevRawPrevTime - 0.0001 : prevRawPrevTime;
				this._cycle = prevCycle;
				this._locked = true; //prevents changes to totalTime and skips repeat/yoyo behavior when we recursively call render()
				prevTime = (backwards) ? 0 : dur;
				this.render(prevTime, suppressEvents, (dur === 0));
				if (!suppressEvents) if (!this._gc) {
					if (this.vars.onRepeat) {
						this.vars.onRepeat.apply(this.vars.onRepeatScope || this, this.vars.onRepeatParams || _blankArray);
					}
				}
				if (wrap) {
					prevTime = (backwards) ? dur + 0.0001 : -0.0001;
					this.render(prevTime, true, false);
				}
				this._locked = false;
				if (this._paused && !prevPaused) { //if the render() triggered callback that paused this timeline, we should abort (very rare, but possible)
					return;
				}
				this._time = recTime;
				this._totalTime = recTotalTime;
				this._cycle = recCycle;
				this._rawPrevTime = recRawPrevTime;
			}

			if ((this._time === prevTime || !this._first) && !force && !internalForce) {
				if (prevTotalTime !== this._totalTime) if (this._onUpdate) if (!suppressEvents) { //so that onUpdate fires even during the repeatDelay - as long as the totalTime changed, we should trigger onUpdate.
					this._onUpdate.apply(this.vars.onUpdateScope || this, this.vars.onUpdateParams || _blankArray);
				}
				return;
			} else if (!this._initted) {
				this._initted = true;
			}

			if (!this._active) if (!this._paused && this._totalTime !== prevTotalTime && time > 0) {
				this._active = true;  //so that if the user renders the timeline (as opposed to the parent timeline rendering it), it is forced to re-render and align it with the proper time/frame on the next rendering cycle. Maybe the timeline already finished but the user manually re-renders it as halfway done, for example.
			}

			if (prevTotalTime === 0) if (this.vars.onStart) if (this._totalTime !== 0) if (!suppressEvents) {
				this.vars.onStart.apply(this.vars.onStartScope || this, this.vars.onStartParams || _blankArray);
			}

			if (this._time >= prevTime) {
				tween = this._first;
				while (tween) {
					next = tween._next; //record it here because the value could change after rendering...
					if (this._paused && !prevPaused) { //in case a tween pauses the timeline when rendering
						break;
					} else if (tween._active || (tween._startTime <= this._time && !tween._paused && !tween._gc)) {
						if (!tween._reversed) {
							tween.render((time - tween._startTime) * tween._timeScale, suppressEvents, force);
						} else {
							tween.render(((!tween._dirty) ? tween._totalDuration : tween.totalDuration()) - ((time - tween._startTime) * tween._timeScale), suppressEvents, force);
						}

					}
					tween = next;
				}
			} else {
				tween = this._last;
				while (tween) {
					next = tween._prev; //record it here because the value could change after rendering...
					if (this._paused && !prevPaused) { //in case a tween pauses the timeline when rendering
						break;
					} else if (tween._active || (tween._startTime <= prevTime && !tween._paused && !tween._gc)) {
						if (!tween._reversed) {
							tween.render((time - tween._startTime) * tween._timeScale, suppressEvents, force);
						} else {
							tween.render(((!tween._dirty) ? tween._totalDuration : tween.totalDuration()) - ((time - tween._startTime) * tween._timeScale), suppressEvents, force);
						}
					}
					tween = next;
				}
			}

			if (this._onUpdate) if (!suppressEvents) {
				if (_lazyTweens.length) { //in case rendering caused any tweens to lazy-init, we should render them because typically when a timeline finishes, users expect things to have rendered fully. Imagine an onUpdate on a timeline that reports/checks tweened values.
					_lazyRender();
				}
				this._onUpdate.apply(this.vars.onUpdateScope || this, this.vars.onUpdateParams || _blankArray);
			}
			if (callback) if (!this._locked) if (!this._gc) if (prevStart === this._startTime || prevTimeScale !== this._timeScale) if (this._time === 0 || totalDur >= this.totalDuration()) { //if one of the tweens that was rendered altered this timeline's startTime (like if an onComplete reversed the timeline), it probably isn't complete. If it is, don't worry, because whatever call altered the startTime would complete if it was necessary at the new time. The only exception is the timeScale property. Also check _gc because there's a chance that kill() could be called in an onUpdate
				if (isComplete) {
					if (_lazyTweens.length) { //in case rendering caused any tweens to lazy-init, we should render them because typically when a timeline finishes, users expect things to have rendered fully. Imagine an onComplete on a timeline that reports/checks tweened values.
						_lazyRender();
					}
					if (this._timeline.autoRemoveChildren) {
						this._enabled(false, false);
					}
					this._active = false;
				}
				if (!suppressEvents && this.vars[callback]) {
					this.vars[callback].apply(this.vars[callback + "Scope"] || this, this.vars[callback + "Params"] || _blankArray);
				}
			}
		};

		p.getActive = function(nested, tweens, timelines) {
			if (nested == null) {
				nested = true;
			}
			if (tweens == null) {
				tweens = true;
			}
			if (timelines == null) {
				timelines = false;
			}
			var a = [],
				all = this.getChildren(nested, tweens, timelines),
				cnt = 0,
				l = all.length,
				i, tween;
			for (i = 0; i < l; i++) {
				tween = all[i];
				if (tween.isActive()) {
					a[cnt++] = tween;
				}
			}
			return a;
		};


		p.getLabelAfter = function(time) {
			if (!time) if (time !== 0) { //faster than isNan()
				time = this._time;
			}
			var labels = this.getLabelsArray(),
				l = labels.length,
				i;
			for (i = 0; i < l; i++) {
				if (labels[i].time > time) {
					return labels[i].name;
				}
			}
			return null;
		};

		p.getLabelBefore = function(time) {
			if (time == null) {
				time = this._time;
			}
			var labels = this.getLabelsArray(),
				i = labels.length;
			while (--i > -1) {
				if (labels[i].time < time) {
					return labels[i].name;
				}
			}
			return null;
		};

		p.getLabelsArray = function() {
			var a = [],
				cnt = 0,
				p;
			for (p in this._labels) {
				a[cnt++] = {time:this._labels[p], name:p};
			}
			a.sort(function(a,b) {
				return a.time - b.time;
			});
			return a;
		};


//---- GETTERS / SETTERS -------------------------------------------------------------------------------------------------------

		p.progress = function(value, suppressEvents) {
			return (!arguments.length) ? this._time / this.duration() : this.totalTime( this.duration() * ((this._yoyo && (this._cycle & 1) !== 0) ? 1 - value : value) + (this._cycle * (this._duration + this._repeatDelay)), suppressEvents);
		};

		p.totalProgress = function(value, suppressEvents) {
			return (!arguments.length) ? this._totalTime / this.totalDuration() : this.totalTime( this.totalDuration() * value, suppressEvents);
		};

		p.totalDuration = function(value) {
			if (!arguments.length) {
				if (this._dirty) {
					TimelineLite.prototype.totalDuration.call(this); //just forces refresh
					//Instead of Infinity, we use 999999999999 so that we can accommodate reverses.
					this._totalDuration = (this._repeat === -1) ? 999999999999 : this._duration * (this._repeat + 1) + (this._repeatDelay * this._repeat);
				}
				return this._totalDuration;
			}
			return (this._repeat === -1) ? this : this.duration( (value - (this._repeat * this._repeatDelay)) / (this._repeat + 1) );
		};

		p.time = function(value, suppressEvents) {
			if (!arguments.length) {
				return this._time;
			}
			if (this._dirty) {
				this.totalDuration();
			}
			if (value > this._duration) {
				value = this._duration;
			}
			if (this._yoyo && (this._cycle & 1) !== 0) {
				value = (this._duration - value) + (this._cycle * (this._duration + this._repeatDelay));
			} else if (this._repeat !== 0) {
				value += this._cycle * (this._duration + this._repeatDelay);
			}
			return this.totalTime(value, suppressEvents);
		};

		p.repeat = function(value) {
			if (!arguments.length) {
				return this._repeat;
			}
			this._repeat = value;
			return this._uncache(true);
		};

		p.repeatDelay = function(value) {
			if (!arguments.length) {
				return this._repeatDelay;
			}
			this._repeatDelay = value;
			return this._uncache(true);
		};

		p.yoyo = function(value) {
			if (!arguments.length) {
				return this._yoyo;
			}
			this._yoyo = value;
			return this;
		};

		p.currentLabel = function(value) {
			if (!arguments.length) {
				return this.getLabelBefore(this._time + 0.00000001);
			}
			return this.seek(value, true);
		};

		return TimelineMax;

	}, true);
	




	
	
	
	
	
	
	
/*
 * ----------------------------------------------------------------
 * BezierPlugin
 * ----------------------------------------------------------------
 */
	(function() {

		var _RAD2DEG = 180 / Math.PI,
			_r1 = [],
			_r2 = [],
			_r3 = [],
			_corProps = {},
			_globals = _gsScope._gsDefine.globals,
			Segment = function(a, b, c, d) {
				this.a = a;
				this.b = b;
				this.c = c;
				this.d = d;
				this.da = d - a;
				this.ca = c - a;
				this.ba = b - a;
			},
			_correlate = ",x,y,z,left,top,right,bottom,marginTop,marginLeft,marginRight,marginBottom,paddingLeft,paddingTop,paddingRight,paddingBottom,backgroundPosition,backgroundPosition_y,",
			cubicToQuadratic = function(a, b, c, d) {
				var q1 = {a:a},
					q2 = {},
					q3 = {},
					q4 = {c:d},
					mab = (a + b) / 2,
					mbc = (b + c) / 2,
					mcd = (c + d) / 2,
					mabc = (mab + mbc) / 2,
					mbcd = (mbc + mcd) / 2,
					m8 = (mbcd - mabc) / 8;
				q1.b = mab + (a - mab) / 4;
				q2.b = mabc + m8;
				q1.c = q2.a = (q1.b + q2.b) / 2;
				q2.c = q3.a = (mabc + mbcd) / 2;
				q3.b = mbcd - m8;
				q4.b = mcd + (d - mcd) / 4;
				q3.c = q4.a = (q3.b + q4.b) / 2;
				return [q1, q2, q3, q4];
			},
			_calculateControlPoints = function(a, curviness, quad, basic, correlate) {
				var l = a.length - 1,
					ii = 0,
					cp1 = a[0].a,
					i, p1, p2, p3, seg, m1, m2, mm, cp2, qb, r1, r2, tl;
				for (i = 0; i < l; i++) {
					seg = a[ii];
					p1 = seg.a;
					p2 = seg.d;
					p3 = a[ii+1].d;

					if (correlate) {
						r1 = _r1[i];
						r2 = _r2[i];
						tl = ((r2 + r1) * curviness * 0.25) / (basic ? 0.5 : _r3[i] || 0.5);
						m1 = p2 - (p2 - p1) * (basic ? curviness * 0.5 : (r1 !== 0 ? tl / r1 : 0));
						m2 = p2 + (p3 - p2) * (basic ? curviness * 0.5 : (r2 !== 0 ? tl / r2 : 0));
						mm = p2 - (m1 + (((m2 - m1) * ((r1 * 3 / (r1 + r2)) + 0.5) / 4) || 0));
					} else {
						m1 = p2 - (p2 - p1) * curviness * 0.5;
						m2 = p2 + (p3 - p2) * curviness * 0.5;
						mm = p2 - (m1 + m2) / 2;
					}
					m1 += mm;
					m2 += mm;

					seg.c = cp2 = m1;
					if (i !== 0) {
						seg.b = cp1;
					} else {
						seg.b = cp1 = seg.a + (seg.c - seg.a) * 0.6; //instead of placing b on a exactly, we move it inline with c so that if the user specifies an ease like Back.easeIn or Elastic.easeIn which goes BEYOND the beginning, it will do so smoothly.
					}

					seg.da = p2 - p1;
					seg.ca = cp2 - p1;
					seg.ba = cp1 - p1;

					if (quad) {
						qb = cubicToQuadratic(p1, cp1, cp2, p2);
						a.splice(ii, 1, qb[0], qb[1], qb[2], qb[3]);
						ii += 4;
					} else {
						ii++;
					}

					cp1 = m2;
				}
				seg = a[ii];
				seg.b = cp1;
				seg.c = cp1 + (seg.d - cp1) * 0.4; //instead of placing c on d exactly, we move it inline with b so that if the user specifies an ease like Back.easeOut or Elastic.easeOut which goes BEYOND the end, it will do so smoothly.
				seg.da = seg.d - seg.a;
				seg.ca = seg.c - seg.a;
				seg.ba = cp1 - seg.a;
				if (quad) {
					qb = cubicToQuadratic(seg.a, cp1, seg.c, seg.d);
					a.splice(ii, 1, qb[0], qb[1], qb[2], qb[3]);
				}
			},
			_parseAnchors = function(values, p, correlate, prepend) {
				var a = [],
					l, i, p1, p2, p3, tmp;
				if (prepend) {
					values = [prepend].concat(values);
					i = values.length;
					while (--i > -1) {
						if (typeof( (tmp = values[i][p]) ) === "string") if (tmp.charAt(1) === "=") {
							values[i][p] = prepend[p] + Number(tmp.charAt(0) + tmp.substr(2)); //accommodate relative values. Do it inline instead of breaking it out into a function for speed reasons
						}
					}
				}
				l = values.length - 2;
				if (l < 0) {
					a[0] = new Segment(values[0][p], 0, 0, values[(l < -1) ? 0 : 1][p]);
					return a;
				}
				for (i = 0; i < l; i++) {
					p1 = values[i][p];
					p2 = values[i+1][p];
					a[i] = new Segment(p1, 0, 0, p2);
					if (correlate) {
						p3 = values[i+2][p];
						_r1[i] = (_r1[i] || 0) + (p2 - p1) * (p2 - p1);
						_r2[i] = (_r2[i] || 0) + (p3 - p2) * (p3 - p2);
					}
				}
				a[i] = new Segment(values[i][p], 0, 0, values[i+1][p]);
				return a;
			},
			bezierThrough = function(values, curviness, quadratic, basic, correlate, prepend) {
				var obj = {},
					props = [],
					first = prepend || values[0],
					i, p, a, j, r, l, seamless, last;
				correlate = (typeof(correlate) === "string") ? ","+correlate+"," : _correlate;
				if (curviness == null) {
					curviness = 1;
				}
				for (p in values[0]) {
					props.push(p);
				}
				//check to see if the last and first values are identical (well, within 0.05). If so, make seamless by appending the second element to the very end of the values array and the 2nd-to-last element to the very beginning (we'll remove those segments later)
				if (values.length > 1) {
					last = values[values.length - 1];
					seamless = true;
					i = props.length;
					while (--i > -1) {
						p = props[i];
						if (Math.abs(first[p] - last[p]) > 0.05) { //build in a tolerance of +/-0.05 to accommodate rounding errors. For example, if you set an object's position to 4.945, Flash will make it 4.9
							seamless = false;
							break;
						}
					}
					if (seamless) {
						values = values.concat(); //duplicate the array to avoid contaminating the original which the user may be reusing for other tweens
						if (prepend) {
							values.unshift(prepend);
						}
						values.push(values[1]);
						prepend = values[values.length - 3];
					}
				}
				_r1.length = _r2.length = _r3.length = 0;
				i = props.length;
				while (--i > -1) {
					p = props[i];
					_corProps[p] = (correlate.indexOf(","+p+",") !== -1);
					obj[p] = _parseAnchors(values, p, _corProps[p], prepend);
				}
				i = _r1.length;
				while (--i > -1) {
					_r1[i] = Math.sqrt(_r1[i]);
					_r2[i] = Math.sqrt(_r2[i]);
				}
				if (!basic) {
					i = props.length;
					while (--i > -1) {
						if (_corProps[p]) {
							a = obj[props[i]];
							l = a.length - 1;
							for (j = 0; j < l; j++) {
								r = a[j+1].da / _r2[j] + a[j].da / _r1[j];
								_r3[j] = (_r3[j] || 0) + r * r;
							}
						}
					}
					i = _r3.length;
					while (--i > -1) {
						_r3[i] = Math.sqrt(_r3[i]);
					}
				}
				i = props.length;
				j = quadratic ? 4 : 1;
				while (--i > -1) {
					p = props[i];
					a = obj[p];
					_calculateControlPoints(a, curviness, quadratic, basic, _corProps[p]); //this method requires that _parseAnchors() and _setSegmentRatios() ran first so that _r1, _r2, and _r3 values are populated for all properties
					if (seamless) {
						a.splice(0, j);
						a.splice(a.length - j, j);
					}
				}
				return obj;
			},
			_parseBezierData = function(values, type, prepend) {
				type = type || "soft";
				var obj = {},
					inc = (type === "cubic") ? 3 : 2,
					soft = (type === "soft"),
					props = [],
					a, b, c, d, cur, i, j, l, p, cnt, tmp;
				if (soft && prepend) {
					values = [prepend].concat(values);
				}
				if (values == null || values.length < inc + 1) { throw "invalid Bezier data"; }
				for (p in values[0]) {
					props.push(p);
				}
				i = props.length;
				while (--i > -1) {
					p = props[i];
					obj[p] = cur = [];
					cnt = 0;
					l = values.length;
					for (j = 0; j < l; j++) {
						a = (prepend == null) ? values[j][p] : (typeof( (tmp = values[j][p]) ) === "string" && tmp.charAt(1) === "=") ? prepend[p] + Number(tmp.charAt(0) + tmp.substr(2)) : Number(tmp);
						if (soft) if (j > 1) if (j < l - 1) {
							cur[cnt++] = (a + cur[cnt-2]) / 2;
						}
						cur[cnt++] = a;
					}
					l = cnt - inc + 1;
					cnt = 0;
					for (j = 0; j < l; j += inc) {
						a = cur[j];
						b = cur[j+1];
						c = cur[j+2];
						d = (inc === 2) ? 0 : cur[j+3];
						cur[cnt++] = tmp = (inc === 3) ? new Segment(a, b, c, d) : new Segment(a, (2 * b + a) / 3, (2 * b + c) / 3, c);
					}
					cur.length = cnt;
				}
				return obj;
			},
			_addCubicLengths = function(a, steps, resolution) {
				var inc = 1 / resolution,
					j = a.length,
					d, d1, s, da, ca, ba, p, i, inv, bez, index;
				while (--j > -1) {
					bez = a[j];
					s = bez.a;
					da = bez.d - s;
					ca = bez.c - s;
					ba = bez.b - s;
					d = d1 = 0;
					for (i = 1; i <= resolution; i++) {
						p = inc * i;
						inv = 1 - p;
						d = d1 - (d1 = (p * p * da + 3 * inv * (p * ca + inv * ba)) * p);
						index = j * resolution + i - 1;
						steps[index] = (steps[index] || 0) + d * d;
					}
				}
			},
			_parseLengthData = function(obj, resolution) {
				resolution = resolution >> 0 || 6;
				var a = [],
					lengths = [],
					d = 0,
					total = 0,
					threshold = resolution - 1,
					segments = [],
					curLS = [], //current length segments array
					p, i, l, index;
				for (p in obj) {
					_addCubicLengths(obj[p], a, resolution);
				}
				l = a.length;
				for (i = 0; i < l; i++) {
					d += Math.sqrt(a[i]);
					index = i % resolution;
					curLS[index] = d;
					if (index === threshold) {
						total += d;
						index = (i / resolution) >> 0;
						segments[index] = curLS;
						lengths[index] = total;
						d = 0;
						curLS = [];
					}
				}
				return {length:total, lengths:lengths, segments:segments};
			},



			BezierPlugin = _gsScope._gsDefine.plugin({
					propName: "bezier",
					priority: -1,
					version: "1.3.4",
					API: 2,
					global:true,

					//gets called when the tween renders for the first time. This is where initial values should be recorded and any setup routines should run.
					init: function(target, vars, tween) {
						this._target = target;
						if (vars instanceof Array) {
							vars = {values:vars};
						}
						this._func = {};
						this._round = {};
						this._props = [];
						this._timeRes = (vars.timeResolution == null) ? 6 : parseInt(vars.timeResolution, 10);
						var values = vars.values || [],
							first = {},
							second = values[0],
							autoRotate = vars.autoRotate || tween.vars.orientToBezier,
							p, isFunc, i, j, prepend;

						this._autoRotate = autoRotate ? (autoRotate instanceof Array) ? autoRotate : [["x","y","rotation",((autoRotate === true) ? 0 : Number(autoRotate) || 0)]] : null;
						for (p in second) {
							this._props.push(p);
						}

						i = this._props.length;
						while (--i > -1) {
							p = this._props[i];

							this._overwriteProps.push(p);
							isFunc = this._func[p] = (typeof(target[p]) === "function");
							first[p] = (!isFunc) ? parseFloat(target[p]) : target[ ((p.indexOf("set") || typeof(target["get" + p.substr(3)]) !== "function") ? p : "get" + p.substr(3)) ]();
							if (!prepend) if (first[p] !== values[0][p]) {
								prepend = first;
							}
						}
						this._beziers = (vars.type !== "cubic" && vars.type !== "quadratic" && vars.type !== "soft") ? bezierThrough(values, isNaN(vars.curviness) ? 1 : vars.curviness, false, (vars.type === "thruBasic"), vars.correlate, prepend) : _parseBezierData(values, vars.type, first);
						this._segCount = this._beziers[p].length;

						if (this._timeRes) {
							var ld = _parseLengthData(this._beziers, this._timeRes);
							this._length = ld.length;
							this._lengths = ld.lengths;
							this._segments = ld.segments;
							this._l1 = this._li = this._s1 = this._si = 0;
							this._l2 = this._lengths[0];
							this._curSeg = this._segments[0];
							this._s2 = this._curSeg[0];
							this._prec = 1 / this._curSeg.length;
						}

						if ((autoRotate = this._autoRotate)) {
							this._initialRotations = [];
							if (!(autoRotate[0] instanceof Array)) {
								this._autoRotate = autoRotate = [autoRotate];
							}
							i = autoRotate.length;
							while (--i > -1) {
								for (j = 0; j < 3; j++) {
									p = autoRotate[i][j];
									this._func[p] = (typeof(target[p]) === "function") ? target[ ((p.indexOf("set") || typeof(target["get" + p.substr(3)]) !== "function") ? p : "get" + p.substr(3)) ] : false;
								}
								p = autoRotate[i][2];
								this._initialRotations[i] = this._func[p] ? this._func[p].call(this._target) : this._target[p];
							}
						}
						this._startRatio = tween.vars.runBackwards ? 1 : 0; //we determine the starting ratio when the tween inits which is always 0 unless the tween has runBackwards:true (indicating it's a from() tween) in which case it's 1.
						return true;
					},

					//called each time the values should be updated, and the ratio gets passed as the only parameter (typically it's a value between 0 and 1, but it can exceed those when using an ease like Elastic.easeOut or Back.easeOut, etc.)
					set: function(v) {
						var segments = this._segCount,
							func = this._func,
							target = this._target,
							notStart = (v !== this._startRatio),
							curIndex, inv, i, p, b, t, val, l, lengths, curSeg;
						if (!this._timeRes) {
							curIndex = (v < 0) ? 0 : (v >= 1) ? segments - 1 : (segments * v) >> 0;
							t = (v - (curIndex * (1 / segments))) * segments;
						} else {
							lengths = this._lengths;
							curSeg = this._curSeg;
							v *= this._length;
							i = this._li;
							//find the appropriate segment (if the currently cached one isn't correct)
							if (v > this._l2 && i < segments - 1) {
								l = segments - 1;
								while (i < l && (this._l2 = lengths[++i]) <= v) {	}
								this._l1 = lengths[i-1];
								this._li = i;
								this._curSeg = curSeg = this._segments[i];
								this._s2 = curSeg[(this._s1 = this._si = 0)];
							} else if (v < this._l1 && i > 0) {
								while (i > 0 && (this._l1 = lengths[--i]) >= v) { }
								if (i === 0 && v < this._l1) {
									this._l1 = 0;
								} else {
									i++;
								}
								this._l2 = lengths[i];
								this._li = i;
								this._curSeg = curSeg = this._segments[i];
								this._s1 = curSeg[(this._si = curSeg.length - 1) - 1] || 0;
								this._s2 = curSeg[this._si];
							}
							curIndex = i;
							//now find the appropriate sub-segment (we split it into the number of pieces that was defined by "precision" and measured each one)
							v -= this._l1;
							i = this._si;
							if (v > this._s2 && i < curSeg.length - 1) {
								l = curSeg.length - 1;
								while (i < l && (this._s2 = curSeg[++i]) <= v) {	}
								this._s1 = curSeg[i-1];
								this._si = i;
							} else if (v < this._s1 && i > 0) {
								while (i > 0 && (this._s1 = curSeg[--i]) >= v) {	}
								if (i === 0 && v < this._s1) {
									this._s1 = 0;
								} else {
									i++;
								}
								this._s2 = curSeg[i];
								this._si = i;
							}
							t = (i + (v - this._s1) / (this._s2 - this._s1)) * this._prec;
						}
						inv = 1 - t;

						i = this._props.length;
						while (--i > -1) {
							p = this._props[i];
							b = this._beziers[p][curIndex];
							val = (t * t * b.da + 3 * inv * (t * b.ca + inv * b.ba)) * t + b.a;
							if (this._round[p]) {
								val = Math.round(val);
							}
							if (func[p]) {
								target[p](val);
							} else {
								target[p] = val;
							}
						}

						if (this._autoRotate) {
							var ar = this._autoRotate,
								b2, x1, y1, x2, y2, add, conv;
							i = ar.length;
							while (--i > -1) {
								p = ar[i][2];
								add = ar[i][3] || 0;
								conv = (ar[i][4] === true) ? 1 : _RAD2DEG;
								b = this._beziers[ar[i][0]];
								b2 = this._beziers[ar[i][1]];

								if (b && b2) { //in case one of the properties got overwritten.
									b = b[curIndex];
									b2 = b2[curIndex];

									x1 = b.a + (b.b - b.a) * t;
									x2 = b.b + (b.c - b.b) * t;
									x1 += (x2 - x1) * t;
									x2 += ((b.c + (b.d - b.c) * t) - x2) * t;

									y1 = b2.a + (b2.b - b2.a) * t;
									y2 = b2.b + (b2.c - b2.b) * t;
									y1 += (y2 - y1) * t;
									y2 += ((b2.c + (b2.d - b2.c) * t) - y2) * t;

									val = notStart ? Math.atan2(y2 - y1, x2 - x1) * conv + add : this._initialRotations[i];

									if (func[p]) {
										target[p](val);
									} else {
										target[p] = val;
									}
								}
							}
						}
					}
			}),
			p = BezierPlugin.prototype;


		BezierPlugin.bezierThrough = bezierThrough;
		BezierPlugin.cubicToQuadratic = cubicToQuadratic;
		BezierPlugin._autoCSS = true; //indicates that this plugin can be inserted into the "css" object using the autoCSS feature of TweenLite
		BezierPlugin.quadraticToCubic = function(a, b, c) {
			return new Segment(a, (2 * b + a) / 3, (2 * b + c) / 3, c);
		};

		BezierPlugin._cssRegister = function() {
			var CSSPlugin = _globals.CSSPlugin;
			if (!CSSPlugin) {
				return;
			}
			var _internals = CSSPlugin._internals,
				_parseToProxy = _internals._parseToProxy,
				_setPluginRatio = _internals._setPluginRatio,
				CSSPropTween = _internals.CSSPropTween;
			_internals._registerComplexSpecialProp("bezier", {parser:function(t, e, prop, cssp, pt, plugin) {
				if (e instanceof Array) {
					e = {values:e};
				}
				plugin = new BezierPlugin();
				var values = e.values,
					l = values.length - 1,
					pluginValues = [],
					v = {},
					i, p, data;
				if (l < 0) {
					return pt;
				}
				for (i = 0; i <= l; i++) {
					data = _parseToProxy(t, values[i], cssp, pt, plugin, (l !== i));
					pluginValues[i] = data.end;
				}
				for (p in e) {
					v[p] = e[p]; //duplicate the vars object because we need to alter some things which would cause problems if the user plans to reuse the same vars object for another tween.
				}
				v.values = pluginValues;
				pt = new CSSPropTween(t, "bezier", 0, 0, data.pt, 2);
				pt.data = data;
				pt.plugin = plugin;
				pt.setRatio = _setPluginRatio;
				if (v.autoRotate === 0) {
					v.autoRotate = true;
				}
				if (v.autoRotate && !(v.autoRotate instanceof Array)) {
					i = (v.autoRotate === true) ? 0 : Number(v.autoRotate);
					v.autoRotate = (data.end.left != null) ? [["left","top","rotation",i,false]] : (data.end.x != null) ? [["x","y","rotation",i,false]] : false;
				}
				if (v.autoRotate) {
					if (!cssp._transform) {
						cssp._enableTransforms(false);
					}
					data.autoRotate = cssp._target._gsTransform;
				}
				plugin._onInitTween(data.proxy, v, cssp._tween);
				return pt;
			}});
		};

		p._roundProps = function(lookup, value) {
			var op = this._overwriteProps,
				i = op.length;
			while (--i > -1) {
				if (lookup[op[i]] || lookup.bezier || lookup.bezierThrough) {
					this._round[op[i]] = value;
				}
			}
		};

		p._kill = function(lookup) {
			var a = this._props,
				p, i;
			for (p in this._beziers) {
				if (p in lookup) {
					delete this._beziers[p];
					delete this._func[p];
					i = a.length;
					while (--i > -1) {
						if (a[i] === p) {
							a.splice(i, 1);
						}
					}
				}
			}
			return this._super._kill.call(this, lookup);
		};

	}());






	
	
	
	
	
	
	
	
/*
 * ----------------------------------------------------------------
 * CSSPlugin
 * ----------------------------------------------------------------
 */
	_gsScope._gsDefine("plugins.CSSPlugin", ["plugins.TweenPlugin","TweenLite"], function(TweenPlugin, TweenLite) {

		/** @constructor **/
		var CSSPlugin = function() {
				TweenPlugin.call(this, "css");
				this._overwriteProps.length = 0;
				this.setRatio = CSSPlugin.prototype.setRatio; //speed optimization (avoid prototype lookup on this "hot" method)
			},
			_globals = _gsScope._gsDefine.globals,
			_hasPriority, //turns true whenever a CSSPropTween instance is created that has a priority other than 0. This helps us discern whether or not we should spend the time organizing the linked list or not after a CSSPlugin's _onInitTween() method is called.
			_suffixMap, //we set this in _onInitTween() each time as a way to have a persistent variable we can use in other methods like _parse() without having to pass it around as a parameter and we keep _parse() decoupled from a particular CSSPlugin instance
			_cs, //computed style (we store this in a shared variable to conserve memory and make minification tighter
			_overwriteProps, //alias to the currently instantiating CSSPlugin's _overwriteProps array. We use this closure in order to avoid having to pass a reference around from method to method and aid in minification.
			_specialProps = {},
			p = CSSPlugin.prototype = new TweenPlugin("css");

		p.constructor = CSSPlugin;
		CSSPlugin.version = "1.15.0";
		CSSPlugin.API = 2;
		CSSPlugin.defaultTransformPerspective = 0;
		CSSPlugin.defaultSkewType = "compensated";
		p = "px"; //we'll reuse the "p" variable to keep file size down
		CSSPlugin.suffixMap = {top:p, right:p, bottom:p, left:p, width:p, height:p, fontSize:p, padding:p, margin:p, perspective:p, lineHeight:""};


		var _numExp = /(?:\d|\-\d|\.\d|\-\.\d)+/g,
			_relNumExp = /(?:\d|\-\d|\.\d|\-\.\d|\+=\d|\-=\d|\+=.\d|\-=\.\d)+/g,
			_valuesExp = /(?:\+=|\-=|\-|\b)[\d\-\.]+[a-zA-Z0-9]*(?:%|\b)/gi, //finds all the values that begin with numbers or += or -= and then a number. Includes suffixes. We use this to split complex values apart like "1px 5px 20px rgb(255,102,51)"
			_NaNExp = /(?![+-]?\d*\.?\d+|[+-]|e[+-]\d+)[^0-9]/g, //also allows scientific notation and doesn't kill the leading -/+ in -= and +=
			_suffixExp = /(?:\d|\-|\+|=|#|\.)*/g,
			_opacityExp = /opacity *= *([^)]*)/i,
			_opacityValExp = /opacity:([^;]*)/i,
			_alphaFilterExp = /alpha\(opacity *=.+?\)/i,
			_rgbhslExp = /^(rgb|hsl)/,
			_capsExp = /([A-Z])/g,
			_camelExp = /-([a-z])/gi,
			_urlExp = /(^(?:url\(\"|url\())|(?:(\"\))$|\)$)/gi, //for pulling out urls from url(...) or url("...") strings (some browsers wrap urls in quotes, some don't when reporting things like backgroundImage)
			_camelFunc = function(s, g) { return g.toUpperCase(); },
			_horizExp = /(?:Left|Right|Width)/i,
			_ieGetMatrixExp = /(M11|M12|M21|M22)=[\d\-\.e]+/gi,
			_ieSetMatrixExp = /progid\:DXImageTransform\.Microsoft\.Matrix\(.+?\)/i,
			_commasOutsideParenExp = /,(?=[^\)]*(?:\(|$))/gi, //finds any commas that are not within parenthesis
			_DEG2RAD = Math.PI / 180,
			_RAD2DEG = 180 / Math.PI,
			_forcePT = {},
			_doc = document,
			_createElement = function(type) {
				return _doc.createElementNS ? _doc.createElementNS("http://www.w3.org/1999/xhtml", type) : _doc.createElement(type);
			},
			_tempDiv = _createElement("div"),
			_tempImg = _createElement("img"),
			_internals = CSSPlugin._internals = {_specialProps:_specialProps}, //provides a hook to a few internal methods that we need to access from inside other plugins
			_agent = navigator.userAgent,
			_autoRound,
			_reqSafariFix, //we won't apply the Safari transform fix until we actually come across a tween that affects a transform property (to maintain best performance).

			_isSafari,
			_isFirefox, //Firefox has a bug that causes 3D transformed elements to randomly disappear unless a repaint is forced after each update on each element.
			_isSafariLT6, //Safari (and Android 4 which uses a flavor of Safari) has a bug that prevents changes to "top" and "left" properties from rendering properly if changed on the same frame as a transform UNLESS we set the element's WebkitBackfaceVisibility to hidden (weird, I know). Doing this for Android 3 and earlier seems to actually cause other problems, though (fun!)
			_ieVers,
			_supportsOpacity = (function() { //we set _isSafari, _ieVers, _isFirefox, and _supportsOpacity all in one function here to reduce file size slightly, especially in the minified version.
				var i = _agent.indexOf("Android"),
					a = _createElement("a");
				_isSafari = (_agent.indexOf("Safari") !== -1 && _agent.indexOf("Chrome") === -1 && (i === -1 || Number(_agent.substr(i+8, 1)) > 3));
				_isSafariLT6 = (_isSafari && (Number(_agent.substr(_agent.indexOf("Version/")+8, 1)) < 6));
				_isFirefox = (_agent.indexOf("Firefox") !== -1);
				if ((/MSIE ([0-9]{1,}[\.0-9]{0,})/).exec(_agent) || (/Trident\/.*rv:([0-9]{1,}[\.0-9]{0,})/).exec(_agent)) {
					_ieVers = parseFloat( RegExp.$1 );
				}
				if (!a) {
					return false;
				}
				a.style.cssText = "top:1px;opacity:.55;";
				return /^0.55/.test(a.style.opacity);
			}()),
			_getIEOpacity = function(v) {
				return (_opacityExp.test( ((typeof(v) === "string") ? v : (v.currentStyle ? v.currentStyle.filter : v.style.filter) || "") ) ? ( parseFloat( RegExp.$1 ) / 100 ) : 1);
			},
			_log = function(s) {//for logging messages, but in a way that won't throw errors in old versions of IE.
				if (window.console) {
					console.log(s);
				}
			},

			_prefixCSS = "", //the non-camelCase vendor prefix like "-o-", "-moz-", "-ms-", or "-webkit-"
			_prefix = "", //camelCase vendor prefix like "O", "ms", "Webkit", or "Moz".

			// @private feed in a camelCase property name like "transform" and it will check to see if it is valid as-is or if it needs a vendor prefix. It returns the corrected camelCase property name (i.e. "WebkitTransform" or "MozTransform" or "transform" or null if no such property is found, like if the browser is IE8 or before, "transform" won't be found at all)
			_checkPropPrefix = function(p, e) {
				e = e || _tempDiv;
				var s = e.style,
					a, i;
				if (s[p] !== undefined) {
					return p;
				}
				p = p.charAt(0).toUpperCase() + p.substr(1);
				a = ["O","Moz","ms","Ms","Webkit"];
				i = 5;
				while (--i > -1 && s[a[i]+p] === undefined) { }
				if (i >= 0) {
					_prefix = (i === 3) ? "ms" : a[i];
					_prefixCSS = "-" + _prefix.toLowerCase() + "-";
					return _prefix + p;
				}
				return null;
			},

			_getComputedStyle = _doc.defaultView ? _doc.defaultView.getComputedStyle : function() {},

			/**
			 * @private Returns the css style for a particular property of an element. For example, to get whatever the current "left" css value for an element with an ID of "myElement", you could do:
			 * var currentLeft = CSSPlugin.getStyle( document.getElementById("myElement"), "left");
			 *
			 * @param {!Object} t Target element whose style property you want to query
			 * @param {!string} p Property name (like "left" or "top" or "marginTop", etc.)
			 * @param {Object=} cs Computed style object. This just provides a way to speed processing if you're going to get several properties on the same element in quick succession - you can reuse the result of the getComputedStyle() call.
			 * @param {boolean=} calc If true, the value will not be read directly from the element's "style" property (if it exists there), but instead the getComputedStyle() result will be used. This can be useful when you want to ensure that the browser itself is interpreting the value.
			 * @param {string=} dflt Default value that should be returned in the place of null, "none", "auto" or "auto auto".
			 * @return {?string} The current property value
			 */
			_getStyle = CSSPlugin.getStyle = function(t, p, cs, calc, dflt) {
				var rv;
				if (!_supportsOpacity) if (p === "opacity") { //several versions of IE don't use the standard "opacity" property - they use things like filter:alpha(opacity=50), so we parse that here.
					return _getIEOpacity(t);
				}
				if (!calc && t.style[p]) {
					rv = t.style[p];
				} else if ((cs = cs || _getComputedStyle(t))) {
					rv = cs[p] || cs.getPropertyValue(p) || cs.getPropertyValue(p.replace(_capsExp, "-$1").toLowerCase());
				} else if (t.currentStyle) {
					rv = t.currentStyle[p];
				}
				return (dflt != null && (!rv || rv === "none" || rv === "auto" || rv === "auto auto")) ? dflt : rv;
			},

			/**
			 * @private Pass the target element, the property name, the numeric value, and the suffix (like "%", "em", "px", etc.) and it will spit back the equivalent pixel number.
			 * @param {!Object} t Target element
			 * @param {!string} p Property name (like "left", "top", "marginLeft", etc.)
			 * @param {!number} v Value
			 * @param {string=} sfx Suffix (like "px" or "%" or "em")
			 * @param {boolean=} recurse If true, the call is a recursive one. In some browsers (like IE7/8), occasionally the value isn't accurately reported initially, but if we run the function again it will take effect.
			 * @return {number} value in pixels
			 */
			_convertToPixels = _internals.convertToPixels = function(t, p, v, sfx, recurse) {
				if (sfx === "px" || !sfx) { return v; }
				if (sfx === "auto" || !v) { return 0; }
				var horiz = _horizExp.test(p),
					node = t,
					style = _tempDiv.style,
					neg = (v < 0),
					pix, cache, time;
				if (neg) {
					v = -v;
				}
				if (sfx === "%" && p.indexOf("border") !== -1) {
					pix = (v / 100) * (horiz ? t.clientWidth : t.clientHeight);
				} else {
					style.cssText = "border:0 solid red;position:" + _getStyle(t, "position") + ";line-height:0;";
					if (sfx === "%" || !node.appendChild) {
						node = t.parentNode || _doc.body;
						cache = node._gsCache;
						time = TweenLite.ticker.frame;
						if (cache && horiz && cache.time === time) { //performance optimization: we record the width of elements along with the ticker frame so that we can quickly get it again on the same tick (seems relatively safe to assume it wouldn't change on the same tick)
							return cache.width * v / 100;
						}
						style[(horiz ? "width" : "height")] = v + sfx;
					} else {
						style[(horiz ? "borderLeftWidth" : "borderTopWidth")] = v + sfx;
					}
					node.appendChild(_tempDiv);
					pix = parseFloat(_tempDiv[(horiz ? "offsetWidth" : "offsetHeight")]);
					node.removeChild(_tempDiv);
					if (horiz && sfx === "%" && CSSPlugin.cacheWidths !== false) {
						cache = node._gsCache = node._gsCache || {};
						cache.time = time;
						cache.width = pix / v * 100;
					}
					if (pix === 0 && !recurse) {
						pix = _convertToPixels(t, p, v, sfx, true);
					}
				}
				return neg ? -pix : pix;
			},
			_calculateOffset = _internals.calculateOffset = function(t, p, cs) { //for figuring out "top" or "left" in px when it's "auto". We need to factor in margin with the offsetLeft/offsetTop
				if (_getStyle(t, "position", cs) !== "absolute") { return 0; }
				var dim = ((p === "left") ? "Left" : "Top"),
					v = _getStyle(t, "margin" + dim, cs);
				return t["offset" + dim] - (_convertToPixels(t, p, parseFloat(v), v.replace(_suffixExp, "")) || 0);
			},

			// @private returns at object containing ALL of the style properties in camelCase and their associated values.
			_getAllStyles = function(t, cs) {
				var s = {},
					i, tr;
				if ((cs = cs || _getComputedStyle(t, null))) {
					if ((i = cs.length)) {
						while (--i > -1) {
							s[cs[i].replace(_camelExp, _camelFunc)] = cs.getPropertyValue(cs[i]);
						}
					} else { //Opera behaves differently - cs.length is always 0, so we must do a for...in loop.
						for (i in cs) {
							s[i] = cs[i];
						}
					}
				} else if ((cs = t.currentStyle || t.style)) {
					for (i in cs) {
						if (typeof(i) === "string" && s[i] === undefined) {
							s[i.replace(_camelExp, _camelFunc)] = cs[i];
						}
					}
				}
				if (!_supportsOpacity) {
					s.opacity = _getIEOpacity(t);
				}
				tr = _getTransform(t, cs, false);
				s.rotation = tr.rotation;
				s.skewX = tr.skewX;
				s.scaleX = tr.scaleX;
				s.scaleY = tr.scaleY;
				s.x = tr.x;
				s.y = tr.y;
				if (_supports3D) {
					s.z = tr.z;
					s.rotationX = tr.rotationX;
					s.rotationY = tr.rotationY;
					s.scaleZ = tr.scaleZ;
				}
				if (s.filters) {
					delete s.filters;
				}
				return s;
			},

			// @private analyzes two style objects (as returned by _getAllStyles()) and only looks for differences between them that contain tweenable values (like a number or color). It returns an object with a "difs" property which refers to an object containing only those isolated properties and values for tweening, and a "firstMPT" property which refers to the first MiniPropTween instance in a linked list that recorded all the starting values of the different properties so that we can revert to them at the end or beginning of the tween - we don't want the cascading to get messed up. The forceLookup parameter is an optional generic object with properties that should be forced into the results - this is necessary for className tweens that are overwriting others because imagine a scenario where a rollover/rollout adds/removes a class and the user swipes the mouse over the target SUPER fast, thus nothing actually changed yet and the subsequent comparison of the properties would indicate they match (especially when px rounding is taken into consideration), thus no tweening is necessary even though it SHOULD tween and remove those properties after the tween (otherwise the inline styles will contaminate things). See the className SpecialProp code for details.
			_cssDif = function(t, s1, s2, vars, forceLookup) {
				var difs = {},
					style = t.style,
					val, p, mpt;
				for (p in s2) {
					if (p !== "cssText") if (p !== "length") if (isNaN(p)) if (s1[p] !== (val = s2[p]) || (forceLookup && forceLookup[p])) if (p.indexOf("Origin") === -1) if (typeof(val) === "number" || typeof(val) === "string") {
						difs[p] = (val === "auto" && (p === "left" || p === "top")) ? _calculateOffset(t, p) : ((val === "" || val === "auto" || val === "none") && typeof(s1[p]) === "string" && s1[p].replace(_NaNExp, "") !== "") ? 0 : val; //if the ending value is defaulting ("" or "auto"), we check the starting value and if it can be parsed into a number (a string which could have a suffix too, like 700px), then we swap in 0 for "" or "auto" so that things actually tween.
						if (style[p] !== undefined) { //for className tweens, we must remember which properties already existed inline - the ones that didn't should be removed when the tween isn't in progress because they were only introduced to facilitate the transition between classes.
							mpt = new MiniPropTween(style, p, style[p], mpt);
						}
					}
				}
				if (vars) {
					for (p in vars) { //copy properties (except className)
						if (p !== "className") {
							difs[p] = vars[p];
						}
					}
				}
				return {difs:difs, firstMPT:mpt};
			},
			_dimensions = {width:["Left","Right"], height:["Top","Bottom"]},
			_margins = ["marginLeft","marginRight","marginTop","marginBottom"],

			/**
			 * @private Gets the width or height of an element
			 * @param {!Object} t Target element
			 * @param {!string} p Property name ("width" or "height")
			 * @param {Object=} cs Computed style object (if one exists). Just a speed optimization.
			 * @return {number} Dimension (in pixels)
			 */
			_getDimension = function(t, p, cs) {
				var v = parseFloat((p === "width") ? t.offsetWidth : t.offsetHeight),
					a = _dimensions[p],
					i = a.length;
				cs = cs || _getComputedStyle(t, null);
				while (--i > -1) {
					v -= parseFloat( _getStyle(t, "padding" + a[i], cs, true) ) || 0;
					v -= parseFloat( _getStyle(t, "border" + a[i] + "Width", cs, true) ) || 0;
				}
				return v;
			},

			// @private Parses position-related complex strings like "top left" or "50px 10px" or "70% 20%", etc. which are used for things like transformOrigin or backgroundPosition. Optionally decorates a supplied object (recObj) with the following properties: "ox" (offsetX), "oy" (offsetY), "oxp" (if true, "ox" is a percentage not a pixel value), and "oxy" (if true, "oy" is a percentage not a pixel value)
			_parsePosition = function(v, recObj) {
				if (v == null || v === "" || v === "auto" || v === "auto auto") { //note: Firefox uses "auto auto" as default whereas Chrome uses "auto".
					v = "0 0";
				}
				var a = v.split(" "),
					x = (v.indexOf("left") !== -1) ? "0%" : (v.indexOf("right") !== -1) ? "100%" : a[0],
					y = (v.indexOf("top") !== -1) ? "0%" : (v.indexOf("bottom") !== -1) ? "100%" : a[1];
				if (y == null) {
					y = "0";
				} else if (y === "center") {
					y = "50%";
				}
				if (x === "center" || (isNaN(parseFloat(x)) && (x + "").indexOf("=") === -1)) { //remember, the user could flip-flop the values and say "bottom center" or "center bottom", etc. "center" is ambiguous because it could be used to describe horizontal or vertical, hence the isNaN(). If there's an "=" sign in the value, it's relative.
					x = "50%";
				}
				if (recObj) {
					recObj.oxp = (x.indexOf("%") !== -1);
					recObj.oyp = (y.indexOf("%") !== -1);
					recObj.oxr = (x.charAt(1) === "=");
					recObj.oyr = (y.charAt(1) === "=");
					recObj.ox = parseFloat(x.replace(_NaNExp, ""));
					recObj.oy = parseFloat(y.replace(_NaNExp, ""));
				}
				return x + " " + y + ((a.length > 2) ? " " + a[2] : "");
			},

			/**
			 * @private Takes an ending value (typically a string, but can be a number) and a starting value and returns the change between the two, looking for relative value indicators like += and -= and it also ignores suffixes (but make sure the ending value starts with a number or +=/-= and that the starting value is a NUMBER!)
			 * @param {(number|string)} e End value which is typically a string, but could be a number
			 * @param {(number|string)} b Beginning value which is typically a string but could be a number
			 * @return {number} Amount of change between the beginning and ending values (relative values that have a "+=" or "-=" are recognized)
			 */
			_parseChange = function(e, b) {
				return (typeof(e) === "string" && e.charAt(1) === "=") ? parseInt(e.charAt(0) + "1", 10) * parseFloat(e.substr(2)) : parseFloat(e) - parseFloat(b);
			},

			/**
			 * @private Takes a value and a default number, checks if the value is relative, null, or numeric and spits back a normalized number accordingly. Primarily used in the _parseTransform() function.
			 * @param {Object} v Value to be parsed
			 * @param {!number} d Default value (which is also used for relative calculations if "+=" or "-=" is found in the first parameter)
			 * @return {number} Parsed value
			 */
			_parseVal = function(v, d) {
				return (v == null) ? d : (typeof(v) === "string" && v.charAt(1) === "=") ? parseInt(v.charAt(0) + "1", 10) * parseFloat(v.substr(2)) + d : parseFloat(v);
			},

			/**
			 * @private Translates strings like "40deg" or "40" or 40rad" or "+=40deg" or "270_short" or "-90_cw" or "+=45_ccw" to a numeric radian angle. Of course a starting/default value must be fed in too so that relative values can be calculated properly.
			 * @param {Object} v Value to be parsed
			 * @param {!number} d Default value (which is also used for relative calculations if "+=" or "-=" is found in the first parameter)
			 * @param {string=} p property name for directionalEnd (optional - only used when the parsed value is directional ("_short", "_cw", or "_ccw" suffix). We need a way to store the uncompensated value so that at the end of the tween, we set it to exactly what was requested with no directional compensation). Property name would be "rotation", "rotationX", or "rotationY"
			 * @param {Object=} directionalEnd An object that will store the raw end values for directional angles ("_short", "_cw", or "_ccw" suffix). We need a way to store the uncompensated value so that at the end of the tween, we set it to exactly what was requested with no directional compensation.
			 * @return {number} parsed angle in radians
			 */
			_parseAngle = function(v, d, p, directionalEnd) {
				var min = 0.000001,
					cap, split, dif, result;
				if (v == null) {
					result = d;
				} else if (typeof(v) === "number") {
					result = v;
				} else {
					cap = 360;
					split = v.split("_");
					dif = Number(split[0].replace(_NaNExp, "")) * ((v.indexOf("rad") === -1) ? 1 : _RAD2DEG) - ((v.charAt(1) === "=") ? 0 : d);
					if (split.length) {
						if (directionalEnd) {
							directionalEnd[p] = d + dif;
						}
						if (v.indexOf("short") !== -1) {
							dif = dif % cap;
							if (dif !== dif % (cap / 2)) {
								dif = (dif < 0) ? dif + cap : dif - cap;
							}
						}
						if (v.indexOf("_cw") !== -1 && dif < 0) {
							dif = ((dif + cap * 9999999999) % cap) - ((dif / cap) | 0) * cap;
						} else if (v.indexOf("ccw") !== -1 && dif > 0) {
							dif = ((dif - cap * 9999999999) % cap) - ((dif / cap) | 0) * cap;
						}
					}
					result = d + dif;
				}
				if (result < min && result > -min) {
					result = 0;
				}
				return result;
			},

			_colorLookup = {aqua:[0,255,255],
				lime:[0,255,0],
				silver:[192,192,192],
				black:[0,0,0],
				maroon:[128,0,0],
				teal:[0,128,128],
				blue:[0,0,255],
				navy:[0,0,128],
				white:[255,255,255],
				fuchsia:[255,0,255],
				olive:[128,128,0],
				yellow:[255,255,0],
				orange:[255,165,0],
				gray:[128,128,128],
				purple:[128,0,128],
				green:[0,128,0],
				red:[255,0,0],
				pink:[255,192,203],
				cyan:[0,255,255],
				transparent:[255,255,255,0]},

			_hue = function(h, m1, m2) {
				h = (h < 0) ? h + 1 : (h > 1) ? h - 1 : h;
				return ((((h * 6 < 1) ? m1 + (m2 - m1) * h * 6 : (h < 0.5) ? m2 : (h * 3 < 2) ? m1 + (m2 - m1) * (2 / 3 - h) * 6 : m1) * 255) + 0.5) | 0;
			},

			/**
			 * @private Parses a color (like #9F0, #FF9900, or rgb(255,51,153)) into an array with 3 elements for red, green, and blue. Also handles rgba() values (splits into array of 4 elements of course)
			 * @param {(string|number)} v The value the should be parsed which could be a string like #9F0 or rgb(255,102,51) or rgba(255,0,0,0.5) or it could be a number like 0xFF00CC or even a named color like red, blue, purple, etc.
			 * @return {Array.<number>} An array containing red, green, and blue (and optionally alpha) in that order.
			 */
			_parseColor = CSSPlugin.parseColor = function(v) {
				var c1, c2, c3, h, s, l;
				if (!v || v === "") {
					return _colorLookup.black;
				}
				if (typeof(v) === "number") {
					return [v >> 16, (v >> 8) & 255, v & 255];
				}
				if (v.charAt(v.length - 1) === ",") { //sometimes a trailing commma is included and we should chop it off (typically from a comma-delimited list of values like a textShadow:"2px 2px 2px blue, 5px 5px 5px rgb(255,0,0)" - in this example "blue," has a trailing comma. We could strip it out inside parseComplex() but we'd need to do it to the beginning and ending values plus it wouldn't provide protection from other potential scenarios like if the user passes in a similar value.
					v = v.substr(0, v.length - 1);
				}
				if (_colorLookup[v]) {
					return _colorLookup[v];
				}
				if (v.charAt(0) === "#") {
					if (v.length === 4) { //for shorthand like #9F0
						c1 = v.charAt(1),
						c2 = v.charAt(2),
						c3 = v.charAt(3);
						v = "#" + c1 + c1 + c2 + c2 + c3 + c3;
					}
					v = parseInt(v.substr(1), 16);
					return [v >> 16, (v >> 8) & 255, v & 255];
				}
				if (v.substr(0, 3) === "hsl") {
					v = v.match(_numExp);
					h = (Number(v[0]) % 360) / 360;
					s = Number(v[1]) / 100;
					l = Number(v[2]) / 100;
					c2 = (l <= 0.5) ? l * (s + 1) : l + s - l * s;
					c1 = l * 2 - c2;
					if (v.length > 3) {
						v[3] = Number(v[3]);
					}
					v[0] = _hue(h + 1 / 3, c1, c2);
					v[1] = _hue(h, c1, c2);
					v[2] = _hue(h - 1 / 3, c1, c2);
					return v;
				}
				v = v.match(_numExp) || _colorLookup.transparent;
				v[0] = Number(v[0]);
				v[1] = Number(v[1]);
				v[2] = Number(v[2]);
				if (v.length > 3) {
					v[3] = Number(v[3]);
				}
				return v;
			},
			_colorExp = "(?:\\b(?:(?:rgb|rgba|hsl|hsla)\\(.+?\\))|\\B#.+?\\b"; //we'll dynamically build this Regular Expression to conserve file size. After building it, it will be able to find rgb(), rgba(), # (hexadecimal), and named color values like red, blue, purple, etc.

		for (p in _colorLookup) {
			_colorExp += "|" + p + "\\b";
		}
		_colorExp = new RegExp(_colorExp+")", "gi");

		/**
		 * @private Returns a formatter function that handles taking a string (or number in some cases) and returning a consistently formatted one in terms of delimiters, quantity of values, etc. For example, we may get boxShadow values defined as "0px red" or "0px 0px 10px rgb(255,0,0)" or "0px 0px 20px 20px #F00" and we need to ensure that what we get back is described with 4 numbers and a color. This allows us to feed it into the _parseComplex() method and split the values up appropriately. The neat thing about this _getFormatter() function is that the dflt defines a pattern as well as a default, so for example, _getFormatter("0px 0px 0px 0px #777", true) not only sets the default as 0px for all distances and #777 for the color, but also sets the pattern such that 4 numbers and a color will always get returned.
		 * @param {!string} dflt The default value and pattern to follow. So "0px 0px 0px 0px #777" will ensure that 4 numbers and a color will always get returned.
		 * @param {boolean=} clr If true, the values should be searched for color-related data. For example, boxShadow values typically contain a color whereas borderRadius don't.
		 * @param {boolean=} collapsible If true, the value is a top/left/right/bottom style one that acts like margin or padding, where if only one value is received, it's used for all 4; if 2 are received, the first is duplicated for 3rd (bottom) and the 2nd is duplicated for the 4th spot (left), etc.
		 * @return {Function} formatter function
		 */
		var _getFormatter = function(dflt, clr, collapsible, multi) {
				if (dflt == null) {
					return function(v) {return v;};
				}
				var dColor = clr ? (dflt.match(_colorExp) || [""])[0] : "",
					dVals = dflt.split(dColor).join("").match(_valuesExp) || [],
					pfx = dflt.substr(0, dflt.indexOf(dVals[0])),
					sfx = (dflt.charAt(dflt.length - 1) === ")") ? ")" : "",
					delim = (dflt.indexOf(" ") !== -1) ? " " : ",",
					numVals = dVals.length,
					dSfx = (numVals > 0) ? dVals[0].replace(_numExp, "") : "",
					formatter;
				if (!numVals) {
					return function(v) {return v;};
				}
				if (clr) {
					formatter = function(v) {
						var color, vals, i, a;
						if (typeof(v) === "number") {
							v += dSfx;
						} else if (multi && _commasOutsideParenExp.test(v)) {
							a = v.replace(_commasOutsideParenExp, "|").split("|");
							for (i = 0; i < a.length; i++) {
								a[i] = formatter(a[i]);
							}
							return a.join(",");
						}
						color = (v.match(_colorExp) || [dColor])[0];
						vals = v.split(color).join("").match(_valuesExp) || [];
						i = vals.length;
						if (numVals > i--) {
							while (++i < numVals) {
								vals[i] = collapsible ? vals[(((i - 1) / 2) | 0)] : dVals[i];
							}
						}
						return pfx + vals.join(delim) + delim + color + sfx + (v.indexOf("inset") !== -1 ? " inset" : "");
					};
					return formatter;

				}
				formatter = function(v) {
					var vals, a, i;
					if (typeof(v) === "number") {
						v += dSfx;
					} else if (multi && _commasOutsideParenExp.test(v)) {
						a = v.replace(_commasOutsideParenExp, "|").split("|");
						for (i = 0; i < a.length; i++) {
							a[i] = formatter(a[i]);
						}
						return a.join(",");
					}
					vals = v.match(_valuesExp) || [];
					i = vals.length;
					if (numVals > i--) {
						while (++i < numVals) {
							vals[i] = collapsible ? vals[(((i - 1) / 2) | 0)] : dVals[i];
						}
					}
					return pfx + vals.join(delim) + sfx;
				};
				return formatter;
			},

			/**
			 * @private returns a formatter function that's used for edge-related values like marginTop, marginLeft, paddingBottom, paddingRight, etc. Just pass a comma-delimited list of property names related to the edges.
			 * @param {!string} props a comma-delimited list of property names in order from top to left, like "marginTop,marginRight,marginBottom,marginLeft"
			 * @return {Function} a formatter function
			 */
			_getEdgeParser = function(props) {
				props = props.split(",");
				return function(t, e, p, cssp, pt, plugin, vars) {
					var a = (e + "").split(" "),
						i;
					vars = {};
					for (i = 0; i < 4; i++) {
						vars[props[i]] = a[i] = a[i] || a[(((i - 1) / 2) >> 0)];
					}
					return cssp.parse(t, vars, pt, plugin);
				};
			},

			// @private used when other plugins must tween values first, like BezierPlugin or ThrowPropsPlugin, etc. That plugin's setRatio() gets called first so that the values are updated, and then we loop through the MiniPropTweens  which handle copying the values into their appropriate slots so that they can then be applied correctly in the main CSSPlugin setRatio() method. Remember, we typically create a proxy object that has a bunch of uniquely-named properties that we feed to the sub-plugin and it does its magic normally, and then we must interpret those values and apply them to the css because often numbers must get combined/concatenated, suffixes added, etc. to work with css, like boxShadow could have 4 values plus a color.
			_setPluginRatio = _internals._setPluginRatio = function(v) {
				this.plugin.setRatio(v);
				var d = this.data,
					proxy = d.proxy,
					mpt = d.firstMPT,
					min = 0.000001,
					val, pt, i, str;
				while (mpt) {
					val = proxy[mpt.v];
					if (mpt.r) {
						val = Math.round(val);
					} else if (val < min && val > -min) {
						val = 0;
					}
					mpt.t[mpt.p] = val;
					mpt = mpt._next;
				}
				if (d.autoRotate) {
					d.autoRotate.rotation = proxy.rotation;
				}
				//at the end, we must set the CSSPropTween's "e" (end) value dynamically here because that's what is used in the final setRatio() method.
				if (v === 1) {
					mpt = d.firstMPT;
					while (mpt) {
						pt = mpt.t;
						if (!pt.type) {
							pt.e = pt.s + pt.xs0;
						} else if (pt.type === 1) {
							str = pt.xs0 + pt.s + pt.xs1;
							for (i = 1; i < pt.l; i++) {
								str += pt["xn"+i] + pt["xs"+(i+1)];
							}
							pt.e = str;
						}
						mpt = mpt._next;
					}
				}
			},

			/**
			 * @private @constructor Used by a few SpecialProps to hold important values for proxies. For example, _parseToProxy() creates a MiniPropTween instance for each property that must get tweened on the proxy, and we record the original property name as well as the unique one we create for the proxy, plus whether or not the value needs to be rounded plus the original value.
			 * @param {!Object} t target object whose property we're tweening (often a CSSPropTween)
			 * @param {!string} p property name
			 * @param {(number|string|object)} v value
			 * @param {MiniPropTween=} next next MiniPropTween in the linked list
			 * @param {boolean=} r if true, the tweened value should be rounded to the nearest integer
			 */
			MiniPropTween = function(t, p, v, next, r) {
				this.t = t;
				this.p = p;
				this.v = v;
				this.r = r;
				if (next) {
					next._prev = this;
					this._next = next;
				}
			},

			/**
			 * @private Most other plugins (like BezierPlugin and ThrowPropsPlugin and others) can only tween numeric values, but CSSPlugin must accommodate special values that have a bunch of extra data (like a suffix or strings between numeric values, etc.). For example, boxShadow has values like "10px 10px 20px 30px rgb(255,0,0)" which would utterly confuse other plugins. This method allows us to split that data apart and grab only the numeric data and attach it to uniquely-named properties of a generic proxy object ({}) so that we can feed that to virtually any plugin to have the numbers tweened. However, we must also keep track of which properties from the proxy go with which CSSPropTween values and instances. So we create a linked list of MiniPropTweens. Each one records a target (the original CSSPropTween), property (like "s" or "xn1" or "xn2") that we're tweening and the unique property name that was used for the proxy (like "boxShadow_xn1" and "boxShadow_xn2") and whether or not they need to be rounded. That way, in the _setPluginRatio() method we can simply copy the values over from the proxy to the CSSPropTween instance(s). Then, when the main CSSPlugin setRatio() method runs and applies the CSSPropTween values accordingly, they're updated nicely. So the external plugin tweens the numbers, _setPluginRatio() copies them over, and setRatio() acts normally, applying css-specific values to the element.
			 * This method returns an object that has the following properties:
			 *  - proxy: a generic object containing the starting values for all the properties that will be tweened by the external plugin.  This is what we feed to the external _onInitTween() as the target
			 *  - end: a generic object containing the ending values for all the properties that will be tweened by the external plugin. This is what we feed to the external plugin's _onInitTween() as the destination values
			 *  - firstMPT: the first MiniPropTween in the linked list
			 *  - pt: the first CSSPropTween in the linked list that was created when parsing. If shallow is true, this linked list will NOT attach to the one passed into the _parseToProxy() as the "pt" (4th) parameter.
			 * @param {!Object} t target object to be tweened
			 * @param {!(Object|string)} vars the object containing the information about the tweening values (typically the end/destination values) that should be parsed
			 * @param {!CSSPlugin} cssp The CSSPlugin instance
			 * @param {CSSPropTween=} pt the next CSSPropTween in the linked list
			 * @param {TweenPlugin=} plugin the external TweenPlugin instance that will be handling tweening the numeric values
			 * @param {boolean=} shallow if true, the resulting linked list from the parse will NOT be attached to the CSSPropTween that was passed in as the "pt" (4th) parameter.
			 * @return An object containing the following properties: proxy, end, firstMPT, and pt (see above for descriptions)
			 */
			_parseToProxy = _internals._parseToProxy = function(t, vars, cssp, pt, plugin, shallow) {
				var bpt = pt,
					start = {},
					end = {},
					transform = cssp._transform,
					oldForce = _forcePT,
					i, p, xp, mpt, firstPT;
				cssp._transform = null;
				_forcePT = vars;
				pt = firstPT = cssp.parse(t, vars, pt, plugin);
				_forcePT = oldForce;
				//break off from the linked list so the new ones are isolated.
				if (shallow) {
					cssp._transform = transform;
					if (bpt) {
						bpt._prev = null;
						if (bpt._prev) {
							bpt._prev._next = null;
						}
					}
				}
				while (pt && pt !== bpt) {
					if (pt.type <= 1) {
						p = pt.p;
						end[p] = pt.s + pt.c;
						start[p] = pt.s;
						if (!shallow) {
							mpt = new MiniPropTween(pt, "s", p, mpt, pt.r);
							pt.c = 0;
						}
						if (pt.type === 1) {
							i = pt.l;
							while (--i > 0) {
								xp = "xn" + i;
								p = pt.p + "_" + xp;
								end[p] = pt.data[xp];
								start[p] = pt[xp];
								if (!shallow) {
									mpt = new MiniPropTween(pt, xp, p, mpt, pt.rxp[xp]);
								}
							}
						}
					}
					pt = pt._next;
				}
				return {proxy:start, end:end, firstMPT:mpt, pt:firstPT};
			},



			/**
			 * @constructor Each property that is tweened has at least one CSSPropTween associated with it. These instances store important information like the target, property, starting value, amount of change, etc. They can also optionally have a number of "extra" strings and numeric values named xs1, xn1, xs2, xn2, xs3, xn3, etc. where "s" indicates string and "n" indicates number. These can be pieced together in a complex-value tween (type:1) that has alternating types of data like a string, number, string, number, etc. For example, boxShadow could be "5px 5px 8px rgb(102, 102, 51)". In that value, there are 6 numbers that may need to tween and then pieced back together into a string again with spaces, suffixes, etc. xs0 is special in that it stores the suffix for standard (type:0) tweens, -OR- the first string (prefix) in a complex-value (type:1) CSSPropTween -OR- it can be the non-tweening value in a type:-1 CSSPropTween. We do this to conserve memory.
			 * CSSPropTweens have the following optional properties as well (not defined through the constructor):
			 *  - l: Length in terms of the number of extra properties that the CSSPropTween has (default: 0). For example, for a boxShadow we may need to tween 5 numbers in which case l would be 5; Keep in mind that the start/end values for the first number that's tweened are always stored in the s and c properties to conserve memory. All additional values thereafter are stored in xn1, xn2, etc.
			 *  - xfirst: The first instance of any sub-CSSPropTweens that are tweening properties of this instance. For example, we may split up a boxShadow tween so that there's a main CSSPropTween of type:1 that has various xs* and xn* values associated with the h-shadow, v-shadow, blur, color, etc. Then we spawn a CSSPropTween for each of those that has a higher priority and runs BEFORE the main CSSPropTween so that the values are all set by the time it needs to re-assemble them. The xfirst gives us an easy way to identify the first one in that chain which typically ends at the main one (because they're all prepende to the linked list)
			 *  - plugin: The TweenPlugin instance that will handle the tweening of any complex values. For example, sometimes we don't want to use normal subtweens (like xfirst refers to) to tween the values - we might want ThrowPropsPlugin or BezierPlugin some other plugin to do the actual tweening, so we create a plugin instance and store a reference here. We need this reference so that if we get a request to round values or disable a tween, we can pass along that request.
			 *  - data: Arbitrary data that needs to be stored with the CSSPropTween. Typically if we're going to have a plugin handle the tweening of a complex-value tween, we create a generic object that stores the END values that we're tweening to and the CSSPropTween's xs1, xs2, etc. have the starting values. We store that object as data. That way, we can simply pass that object to the plugin and use the CSSPropTween as the target.
			 *  - setRatio: Only used for type:2 tweens that require custom functionality. In this case, we call the CSSPropTween's setRatio() method and pass the ratio each time the tween updates. This isn't quite as efficient as doing things directly in the CSSPlugin's setRatio() method, but it's very convenient and flexible.
			 * @param {!Object} t Target object whose property will be tweened. Often a DOM element, but not always. It could be anything.
			 * @param {string} p Property to tween (name). For example, to tween element.width, p would be "width".
			 * @param {number} s Starting numeric value
			 * @param {number} c Change in numeric value over the course of the entire tween. For example, if element.width starts at 5 and should end at 100, c would be 95.
			 * @param {CSSPropTween=} next The next CSSPropTween in the linked list. If one is defined, we will define its _prev as the new instance, and the new instance's _next will be pointed at it.
			 * @param {number=} type The type of CSSPropTween where -1 = a non-tweening value, 0 = a standard simple tween, 1 = a complex value (like one that has multiple numbers in a comma- or space-delimited string like border:"1px solid red"), and 2 = one that uses a custom setRatio function that does all of the work of applying the values on each update.
			 * @param {string=} n Name of the property that should be used for overwriting purposes which is typically the same as p but not always. For example, we may need to create a subtween for the 2nd part of a "clip:rect(...)" tween in which case "p" might be xs1 but "n" is still "clip"
			 * @param {boolean=} r If true, the value(s) should be rounded
			 * @param {number=} pr Priority in the linked list order. Higher priority CSSPropTweens will be updated before lower priority ones. The default priority is 0.
			 * @param {string=} b Beginning value. We store this to ensure that it is EXACTLY what it was when the tween began without any risk of interpretation issues.
			 * @param {string=} e Ending value. We store this to ensure that it is EXACTLY what the user defined at the end of the tween without any risk of interpretation issues.
			 */
			CSSPropTween = _internals.CSSPropTween = function(t, p, s, c, next, type, n, r, pr, b, e) {
				this.t = t; //target
				this.p = p; //property
				this.s = s; //starting value
				this.c = c; //change value
				this.n = n || p; //name that this CSSPropTween should be associated to (usually the same as p, but not always - n is what overwriting looks at)
				if (!(t instanceof CSSPropTween)) {
					_overwriteProps.push(this.n);
				}
				this.r = r; //round (boolean)
				this.type = type || 0; //0 = normal tween, -1 = non-tweening (in which case xs0 will be applied to the target's property, like tp.t[tp.p] = tp.xs0), 1 = complex-value SpecialProp, 2 = custom setRatio() that does all the work
				if (pr) {
					this.pr = pr;
					_hasPriority = true;
				}
				this.b = (b === undefined) ? s : b;
				this.e = (e === undefined) ? s + c : e;
				if (next) {
					this._next = next;
					next._prev = this;
				}
			},

			/**
			 * Takes a target, the beginning value and ending value (as strings) and parses them into a CSSPropTween (possibly with child CSSPropTweens) that accommodates multiple numbers, colors, comma-delimited values, etc. For example:
			 * sp.parseComplex(element, "boxShadow", "5px 10px 20px rgb(255,102,51)", "0px 0px 0px red", true, "0px 0px 0px rgb(0,0,0,0)", pt);
			 * It will walk through the beginning and ending values (which should be in the same format with the same number and type of values) and figure out which parts are numbers, what strings separate the numeric/tweenable values, and then create the CSSPropTweens accordingly. If a plugin is defined, no child CSSPropTweens will be created. Instead, the ending values will be stored in the "data" property of the returned CSSPropTween like: {s:-5, xn1:-10, xn2:-20, xn3:255, xn4:0, xn5:0} so that it can be fed to any other plugin and it'll be plain numeric tweens but the recomposition of the complex value will be handled inside CSSPlugin's setRatio().
			 * If a setRatio is defined, the type of the CSSPropTween will be set to 2 and recomposition of the values will be the responsibility of that method.
			 *
			 * @param {!Object} t Target whose property will be tweened
			 * @param {!string} p Property that will be tweened (its name, like "left" or "backgroundColor" or "boxShadow")
			 * @param {string} b Beginning value
			 * @param {string} e Ending value
			 * @param {boolean} clrs If true, the value could contain a color value like "rgb(255,0,0)" or "#F00" or "red". The default is false, so no colors will be recognized (a performance optimization)
			 * @param {(string|number|Object)} dflt The default beginning value that should be used if no valid beginning value is defined or if the number of values inside the complex beginning and ending values don't match
			 * @param {?CSSPropTween} pt CSSPropTween instance that is the current head of the linked list (we'll prepend to this).
			 * @param {number=} pr Priority in the linked list order. Higher priority properties will be updated before lower priority ones. The default priority is 0.
			 * @param {TweenPlugin=} plugin If a plugin should handle the tweening of extra properties, pass the plugin instance here. If one is defined, then NO subtweens will be created for any extra properties (the properties will be created - just not additional CSSPropTween instances to tween them) because the plugin is expected to do so. However, the end values WILL be populated in the "data" property, like {s:100, xn1:50, xn2:300}
			 * @param {function(number)=} setRatio If values should be set in a custom function instead of being pieced together in a type:1 (complex-value) CSSPropTween, define that custom function here.
			 * @return {CSSPropTween} The first CSSPropTween in the linked list which includes the new one(s) added by the parseComplex() call.
			 */
			_parseComplex = CSSPlugin.parseComplex = function(t, p, b, e, clrs, dflt, pt, pr, plugin, setRatio) {
				//DEBUG: _log("parseComplex: "+p+", b: "+b+", e: "+e);
				b = b || dflt || "";
				pt = new CSSPropTween(t, p, 0, 0, pt, (setRatio ? 2 : 1), null, false, pr, b, e);
				e += ""; //ensures it's a string
				var ba = b.split(", ").join(",").split(" "), //beginning array
					ea = e.split(", ").join(",").split(" "), //ending array
					l = ba.length,
					autoRound = (_autoRound !== false),
					i, xi, ni, bv, ev, bnums, enums, bn, rgba, temp, cv, str;
				if (e.indexOf(",") !== -1 || b.indexOf(",") !== -1) {
					ba = ba.join(" ").replace(_commasOutsideParenExp, ", ").split(" ");
					ea = ea.join(" ").replace(_commasOutsideParenExp, ", ").split(" ");
					l = ba.length;
				}
				if (l !== ea.length) {
					//DEBUG: _log("mismatched formatting detected on " + p + " (" + b + " vs " + e + ")");
					ba = (dflt || "").split(" ");
					l = ba.length;
				}
				pt.plugin = plugin;
				pt.setRatio = setRatio;
				for (i = 0; i < l; i++) {
					bv = ba[i];
					ev = ea[i];
					bn = parseFloat(bv);

					//if the value begins with a number (most common). It's fine if it has a suffix like px
					if (bn || bn === 0) {
						pt.appendXtra("", bn, _parseChange(ev, bn), ev.replace(_relNumExp, ""), (autoRound && ev.indexOf("px") !== -1), true);

					//if the value is a color
					} else if (clrs && (bv.charAt(0) === "#" || _colorLookup[bv] || _rgbhslExp.test(bv))) {
						str = ev.charAt(ev.length - 1) === "," ? ")," : ")"; //if there's a comma at the end, retain it.
						bv = _parseColor(bv);
						ev = _parseColor(ev);
						rgba = (bv.length + ev.length > 6);
						if (rgba && !_supportsOpacity && ev[3] === 0) { //older versions of IE don't support rgba(), so if the destination alpha is 0, just use "transparent" for the end color
							pt["xs" + pt.l] += pt.l ? " transparent" : "transparent";
							pt.e = pt.e.split(ea[i]).join("transparent");
						} else {
							if (!_supportsOpacity) { //old versions of IE don't support rgba().
								rgba = false;
							}
							pt.appendXtra((rgba ? "rgba(" : "rgb("), bv[0], ev[0] - bv[0], ",", true, true)
								.appendXtra("", bv[1], ev[1] - bv[1], ",", true)
								.appendXtra("", bv[2], ev[2] - bv[2], (rgba ? "," : str), true);
							if (rgba) {
								bv = (bv.length < 4) ? 1 : bv[3];
								pt.appendXtra("", bv, ((ev.length < 4) ? 1 : ev[3]) - bv, str, false);
							}
						}

					} else {
						bnums = bv.match(_numExp); //gets each group of numbers in the beginning value string and drops them into an array

						//if no number is found, treat it as a non-tweening value and just append the string to the current xs.
						if (!bnums) {
							pt["xs" + pt.l] += pt.l ? " " + bv : bv;

						//loop through all the numbers that are found and construct the extra values on the pt.
						} else {
							enums = ev.match(_relNumExp); //get each group of numbers in the end value string and drop them into an array. We allow relative values too, like +=50 or -=.5
							if (!enums || enums.length !== bnums.length) {
								//DEBUG: _log("mismatched formatting detected on " + p + " (" + b + " vs " + e + ")");
								return pt;
							}
							ni = 0;
							for (xi = 0; xi < bnums.length; xi++) {
								cv = bnums[xi];
								temp = bv.indexOf(cv, ni);
								pt.appendXtra(bv.substr(ni, temp - ni), Number(cv), _parseChange(enums[xi], cv), "", (autoRound && bv.substr(temp + cv.length, 2) === "px"), (xi === 0));
								ni = temp + cv.length;
							}
							pt["xs" + pt.l] += bv.substr(ni);
						}
					}
				}
				//if there are relative values ("+=" or "-=" prefix), we need to adjust the ending value to eliminate the prefixes and combine the values properly.
				if (e.indexOf("=") !== -1) if (pt.data) {
					str = pt.xs0 + pt.data.s;
					for (i = 1; i < pt.l; i++) {
						str += pt["xs" + i] + pt.data["xn" + i];
					}
					pt.e = str + pt["xs" + i];
				}
				if (!pt.l) {
					pt.type = -1;
					pt.xs0 = pt.e;
				}
				return pt.xfirst || pt;
			},
			i = 9;


		p = CSSPropTween.prototype;
		p.l = p.pr = 0; //length (number of extra properties like xn1, xn2, xn3, etc.
		while (--i > 0) {
			p["xn" + i] = 0;
			p["xs" + i] = "";
		}
		p.xs0 = "";
		p._next = p._prev = p.xfirst = p.data = p.plugin = p.setRatio = p.rxp = null;


		/**
		 * Appends and extra tweening value to a CSSPropTween and automatically manages any prefix and suffix strings. The first extra value is stored in the s and c of the main CSSPropTween instance, but thereafter any extras are stored in the xn1, xn2, xn3, etc. The prefixes and suffixes are stored in the xs0, xs1, xs2, etc. properties. For example, if I walk through a clip value like "rect(10px, 5px, 0px, 20px)", the values would be stored like this:
		 * xs0:"rect(", s:10, xs1:"px, ", xn1:5, xs2:"px, ", xn2:0, xs3:"px, ", xn3:20, xn4:"px)"
		 * And they'd all get joined together when the CSSPlugin renders (in the setRatio() method).
		 * @param {string=} pfx Prefix (if any)
		 * @param {!number} s Starting value
		 * @param {!number} c Change in numeric value over the course of the entire tween. For example, if the start is 5 and the end is 100, the change would be 95.
		 * @param {string=} sfx Suffix (if any)
		 * @param {boolean=} r Round (if true).
		 * @param {boolean=} pad If true, this extra value should be separated by the previous one by a space. If there is no previous extra and pad is true, it will automatically drop the space.
		 * @return {CSSPropTween} returns itself so that multiple methods can be chained together.
		 */
		p.appendXtra = function(pfx, s, c, sfx, r, pad) {
			var pt = this,
				l = pt.l;
			pt["xs" + l] += (pad && l) ? " " + pfx : pfx || "";
			if (!c) if (l !== 0 && !pt.plugin) { //typically we'll combine non-changing values right into the xs to optimize performance, but we don't combine them when there's a plugin that will be tweening the values because it may depend on the values being split apart, like for a bezier, if a value doesn't change between the first and second iteration but then it does on the 3rd, we'll run into trouble because there's no xn slot for that value!
				pt["xs" + l] += s + (sfx || "");
				return pt;
			}
			pt.l++;
			pt.type = pt.setRatio ? 2 : 1;
			pt["xs" + pt.l] = sfx || "";
			if (l > 0) {
				pt.data["xn" + l] = s + c;
				pt.rxp["xn" + l] = r; //round extra property (we need to tap into this in the _parseToProxy() method)
				pt["xn" + l] = s;
				if (!pt.plugin) {
					pt.xfirst = new CSSPropTween(pt, "xn" + l, s, c, pt.xfirst || pt, 0, pt.n, r, pt.pr);
					pt.xfirst.xs0 = 0; //just to ensure that the property stays numeric which helps modern browsers speed up processing. Remember, in the setRatio() method, we do pt.t[pt.p] = val + pt.xs0 so if pt.xs0 is "" (the default), it'll cast the end value as a string. When a property is a number sometimes and a string sometimes, it prevents the compiler from locking in the data type, slowing things down slightly.
				}
				return pt;
			}
			pt.data = {s:s + c};
			pt.rxp = {};
			pt.s = s;
			pt.c = c;
			pt.r = r;
			return pt;
		};

		/**
		 * @constructor A SpecialProp is basically a css property that needs to be treated in a non-standard way, like if it may contain a complex value like boxShadow:"5px 10px 15px rgb(255, 102, 51)" or if it is associated with another plugin like ThrowPropsPlugin or BezierPlugin. Every SpecialProp is associated with a particular property name like "boxShadow" or "throwProps" or "bezier" and it will intercept those values in the vars object that's passed to the CSSPlugin and handle them accordingly.
		 * @param {!string} p Property name (like "boxShadow" or "throwProps")
		 * @param {Object=} options An object containing any of the following configuration options:
		 *                      - defaultValue: the default value
		 *                      - parser: A function that should be called when the associated property name is found in the vars. This function should return a CSSPropTween instance and it should ensure that it is properly inserted into the linked list. It will receive 4 paramters: 1) The target, 2) The value defined in the vars, 3) The CSSPlugin instance (whose _firstPT should be used for the linked list), and 4) A computed style object if one was calculated (this is a speed optimization that allows retrieval of starting values quicker)
		 *                      - formatter: a function that formats any value received for this special property (for example, boxShadow could take "5px 5px red" and format it to "5px 5px 0px 0px red" so that both the beginning and ending values have a common order and quantity of values.)
		 *                      - prefix: if true, we'll determine whether or not this property requires a vendor prefix (like Webkit or Moz or ms or O)
		 *                      - color: set this to true if the value for this SpecialProp may contain color-related values like rgb(), rgba(), etc.
		 *                      - priority: priority in the linked list order. Higher priority SpecialProps will be updated before lower priority ones. The default priority is 0.
		 *                      - multi: if true, the formatter should accommodate a comma-delimited list of values, like boxShadow could have multiple boxShadows listed out.
		 *                      - collapsible: if true, the formatter should treat the value like it's a top/right/bottom/left value that could be collapsed, like "5px" would apply to all, "5px, 10px" would use 5px for top/bottom and 10px for right/left, etc.
		 *                      - keyword: a special keyword that can [optionally] be found inside the value (like "inset" for boxShadow). This allows us to validate beginning/ending values to make sure they match (if the keyword is found in one, it'll be added to the other for consistency by default).
		 */
		var SpecialProp = function(p, options) {
				options = options || {};
				this.p = options.prefix ? _checkPropPrefix(p) || p : p;
				_specialProps[p] = _specialProps[this.p] = this;
				this.format = options.formatter || _getFormatter(options.defaultValue, options.color, options.collapsible, options.multi);
				if (options.parser) {
					this.parse = options.parser;
				}
				this.clrs = options.color;
				this.multi = options.multi;
				this.keyword = options.keyword;
				this.dflt = options.defaultValue;
				this.pr = options.priority || 0;
			},

			//shortcut for creating a new SpecialProp that can accept multiple properties as a comma-delimited list (helps minification). dflt can be an array for multiple values (we don't do a comma-delimited list because the default value may contain commas, like rect(0px,0px,0px,0px)). We attach this method to the SpecialProp class/object instead of using a private _createSpecialProp() method so that we can tap into it externally if necessary, like from another plugin.
			_registerComplexSpecialProp = _internals._registerComplexSpecialProp = function(p, options, defaults) {
				if (typeof(options) !== "object") {
					options = {parser:defaults}; //to make backwards compatible with older versions of BezierPlugin and ThrowPropsPlugin
				}
				var a = p.split(","),
					d = options.defaultValue,
					i, temp;
				defaults = defaults || [d];
				for (i = 0; i < a.length; i++) {
					options.prefix = (i === 0 && options.prefix);
					options.defaultValue = defaults[i] || d;
					temp = new SpecialProp(a[i], options);
				}
			},

			//creates a placeholder special prop for a plugin so that the property gets caught the first time a tween of it is attempted, and at that time it makes the plugin register itself, thus taking over for all future tweens of that property. This allows us to not mandate that things load in a particular order and it also allows us to log() an error that informs the user when they attempt to tween an external plugin-related property without loading its .js file.
			_registerPluginProp = function(p) {
				if (!_specialProps[p]) {
					var pluginName = p.charAt(0).toUpperCase() + p.substr(1) + "Plugin";
					_registerComplexSpecialProp(p, {parser:function(t, e, p, cssp, pt, plugin, vars) {
						var pluginClass = _globals.com.greensock.plugins[pluginName];
						if (!pluginClass) {
							_log("Error: " + pluginName + " js file not loaded.");
							return pt;
						}
						pluginClass._cssRegister();
						return _specialProps[p].parse(t, e, p, cssp, pt, plugin, vars);
					}});
				}
			};


		p = SpecialProp.prototype;

		/**
		 * Alias for _parseComplex() that automatically plugs in certain values for this SpecialProp, like its property name, whether or not colors should be sensed, the default value, and priority. It also looks for any keyword that the SpecialProp defines (like "inset" for boxShadow) and ensures that the beginning and ending values have the same number of values for SpecialProps where multi is true (like boxShadow and textShadow can have a comma-delimited list)
		 * @param {!Object} t target element
		 * @param {(string|number|object)} b beginning value
		 * @param {(string|number|object)} e ending (destination) value
		 * @param {CSSPropTween=} pt next CSSPropTween in the linked list
		 * @param {TweenPlugin=} plugin If another plugin will be tweening the complex value, that TweenPlugin instance goes here.
		 * @param {function=} setRatio If a custom setRatio() method should be used to handle this complex value, that goes here.
		 * @return {CSSPropTween=} First CSSPropTween in the linked list
		 */
		p.parseComplex = function(t, b, e, pt, plugin, setRatio) {
			var kwd = this.keyword,
				i, ba, ea, l, bi, ei;
			//if this SpecialProp's value can contain a comma-delimited list of values (like boxShadow or textShadow), we must parse them in a special way, and look for a keyword (like "inset" for boxShadow) and ensure that the beginning and ending BOTH have it if the end defines it as such. We also must ensure that there are an equal number of values specified (we can't tween 1 boxShadow to 3 for example)
			if (this.multi) if (_commasOutsideParenExp.test(e) || _commasOutsideParenExp.test(b)) {
				ba = b.replace(_commasOutsideParenExp, "|").split("|");
				ea = e.replace(_commasOutsideParenExp, "|").split("|");
			} else if (kwd) {
				ba = [b];
				ea = [e];
			}
			if (ea) {
				l = (ea.length > ba.length) ? ea.length : ba.length;
				for (i = 0; i < l; i++) {
					b = ba[i] = ba[i] || this.dflt;
					e = ea[i] = ea[i] || this.dflt;
					if (kwd) {
						bi = b.indexOf(kwd);
						ei = e.indexOf(kwd);
						if (bi !== ei) {
							e = (ei === -1) ? ea : ba;
							e[i] += " " + kwd;
						}
					}
				}
				b = ba.join(", ");
				e = ea.join(", ");
			}
			return _parseComplex(t, this.p, b, e, this.clrs, this.dflt, pt, this.pr, plugin, setRatio);
		};

		/**
		 * Accepts a target and end value and spits back a CSSPropTween that has been inserted into the CSSPlugin's linked list and conforms with all the conventions we use internally, like type:-1, 0, 1, or 2, setting up any extra property tweens, priority, etc. For example, if we have a boxShadow SpecialProp and call:
		 * this._firstPT = sp.parse(element, "5px 10px 20px rgb(2550,102,51)", "boxShadow", this);
		 * It should figure out the starting value of the element's boxShadow, compare it to the provided end value and create all the necessary CSSPropTweens of the appropriate types to tween the boxShadow. The CSSPropTween that gets spit back should already be inserted into the linked list (the 4th parameter is the current head, so prepend to that).
		 * @param {!Object} t Target object whose property is being tweened
		 * @param {Object} e End value as provided in the vars object (typically a string, but not always - like a throwProps would be an object).
		 * @param {!string} p Property name
		 * @param {!CSSPlugin} cssp The CSSPlugin instance that should be associated with this tween.
		 * @param {?CSSPropTween} pt The CSSPropTween that is the current head of the linked list (we'll prepend to it)
		 * @param {TweenPlugin=} plugin If a plugin will be used to tween the parsed value, this is the plugin instance.
		 * @param {Object=} vars Original vars object that contains the data for parsing.
		 * @return {CSSPropTween} The first CSSPropTween in the linked list which includes the new one(s) added by the parse() call.
		 */
		p.parse = function(t, e, p, cssp, pt, plugin, vars) {
			return this.parseComplex(t.style, this.format(_getStyle(t, this.p, _cs, false, this.dflt)), this.format(e), pt, plugin);
		};

		/**
		 * Registers a special property that should be intercepted from any "css" objects defined in tweens. This allows you to handle them however you want without CSSPlugin doing it for you. The 2nd parameter should be a function that accepts 3 parameters:
		 *  1) Target object whose property should be tweened (typically a DOM element)
		 *  2) The end/destination value (could be a string, number, object, or whatever you want)
		 *  3) The tween instance (you probably don't need to worry about this, but it can be useful for looking up information like the duration)
		 *
		 * Then, your function should return a function which will be called each time the tween gets rendered, passing a numeric "ratio" parameter to your function that indicates the change factor (usually between 0 and 1). For example:
		 *
		 * CSSPlugin.registerSpecialProp("myCustomProp", function(target, value, tween) {
		 *      var start = target.style.width;
		 *      return function(ratio) {
		 *              target.style.width = (start + value * ratio) + "px";
		 *              console.log("set width to " + target.style.width);
		 *          }
		 * }, 0);
		 *
		 * Then, when I do this tween, it will trigger my special property:
		 *
		 * TweenLite.to(element, 1, {css:{myCustomProp:100}});
		 *
		 * In the example, of course, we're just changing the width, but you can do anything you want.
		 *
		 * @param {!string} name Property name (or comma-delimited list of property names) that should be intercepted and handled by your function. For example, if I define "myCustomProp", then it would handle that portion of the following tween: TweenLite.to(element, 1, {css:{myCustomProp:100}})
		 * @param {!function(Object, Object, Object, string):function(number)} onInitTween The function that will be called when a tween of this special property is performed. The function will receive 4 parameters: 1) Target object that should be tweened, 2) Value that was passed to the tween, 3) The tween instance itself (rarely used), and 4) The property name that's being tweened. Your function should return a function that should be called on every update of the tween. That function will receive a single parameter that is a "change factor" value (typically between 0 and 1) indicating the amount of change as a ratio. You can use this to determine how to set the values appropriately in your function.
		 * @param {number=} priority Priority that helps the engine determine the order in which to set the properties (default: 0). Higher priority properties will be updated before lower priority ones.
		 */
		CSSPlugin.registerSpecialProp = function(name, onInitTween, priority) {
			_registerComplexSpecialProp(name, {parser:function(t, e, p, cssp, pt, plugin, vars) {
				var rv = new CSSPropTween(t, p, 0, 0, pt, 2, p, false, priority);
				rv.plugin = plugin;
				rv.setRatio = onInitTween(t, e, cssp._tween, p);
				return rv;
			}, priority:priority});
		};







		//transform-related methods and properties
		var _transformProps = ("scaleX,scaleY,scaleZ,x,y,z,skewX,skewY,rotation,rotationX,rotationY,perspective,xPercent,yPercent").split(","),
			_transformProp = _checkPropPrefix("transform"), //the Javascript (camelCase) transform property, like msTransform, WebkitTransform, MozTransform, or OTransform.
			_transformPropCSS = _prefixCSS + "transform",
			_transformOriginProp = _checkPropPrefix("transformOrigin"),
			_supports3D = (_checkPropPrefix("perspective") !== null),
			Transform = _internals.Transform = function() {
				this.perspective = parseFloat(CSSPlugin.defaultTransformPerspective) || 0;
				this.force3D = (CSSPlugin.defaultForce3D === false || !_supports3D) ? false : CSSPlugin.defaultForce3D || "auto";
			},
			_SVGElement = window.SVGElement,
			_useSVGTransformAttr,
			//Some browsers (like Firefox and IE) don't honor transform-origin properly in SVG elements, so we need to manually adjust the matrix accordingly. We feature detect here rather than always doing the conversion for certain browsers because they may fix the problem at some point in the future.

			_createSVG = function(type, container, attributes) {
				var element = _doc.createElementNS("http://www.w3.org/2000/svg", type),
					reg = /([a-z])([A-Z])/g,
					p;
				for (p in attributes) {
					element.setAttributeNS(null, p.replace(reg, "$1-$2").toLowerCase(), attributes[p]);
				}
				container.appendChild(element);
				return element;
			},
			_docElement = document.documentElement,
			_forceSVGTransformAttr = (function() {
				//IE and Android stock don't support CSS transforms on SVG elements, so we must write them to the "transform" attribute. We populate this variable in the _parseTransform() method, and only if/when we come across an SVG element
				var force = _ieVers || (/Android/i.test(_agent) && !window.chrome),
					svg, rect, width;
				if (_doc.createElementNS && !force) { //IE8 and earlier doesn't support SVG anyway
					svg = _createSVG("svg", _docElement);
					rect = _createSVG("rect", svg, {width:100, height:50, x:100});
					width = rect.getBoundingClientRect().width;
					rect.style[_transformOriginProp] = "50% 50%";
					rect.style[_transformProp] = "scaleX(0.5)";
					force = (width === rect.getBoundingClientRect().width);
					_docElement.removeChild(svg);
				}
				return force;
			})(),
			_parseSVGOrigin = function(e, origin, decoratee) {
				var bbox = e.getBBox();
				origin = _parsePosition(origin).split(" ");
				decoratee.xOrigin = (origin[0].indexOf("%") !== -1 ? parseFloat(origin[0]) / 100 * bbox.width : parseFloat(origin[0])) + bbox.x;
				decoratee.yOrigin = (origin[1].indexOf("%") !== -1 ? parseFloat(origin[1]) / 100 * bbox.height : parseFloat(origin[1])) + bbox.y;
			},

			/**
			 * Parses the transform values for an element, returning an object with x, y, z, scaleX, scaleY, scaleZ, rotation, rotationX, rotationY, skewX, and skewY properties. Note: by default (for performance reasons), all skewing is combined into skewX and rotation but skewY still has a place in the transform object so that we can record how much of the skew is attributed to skewX vs skewY. Remember, a skewY of 10 looks the same as a rotation of 10 and skewX of -10.
			 * @param {!Object} t target element
			 * @param {Object=} cs computed style object (optional)
			 * @param {boolean=} rec if true, the transform values will be recorded to the target element's _gsTransform object, like target._gsTransform = {x:0, y:0, z:0, scaleX:1...}
			 * @param {boolean=} parse if true, we'll ignore any _gsTransform values that already exist on the element, and force a reparsing of the css (calculated style)
			 * @return {object} object containing all of the transform properties/values like {x:0, y:0, z:0, scaleX:1...}
			 */
			_getTransform = _internals.getTransform = function(t, cs, rec, parse) {
				if (t._gsTransform && rec && !parse) {
					return t._gsTransform; //if the element already has a _gsTransform, use that. Note: some browsers don't accurately return the calculated style for the transform (particularly for SVG), so it's almost always safest to just use the values we've already applied rather than re-parsing things.
				}
				var tm = rec ? t._gsTransform || new Transform() : new Transform(),
					invX = (tm.scaleX < 0), //in order to interpret things properly, we need to know if the user applied a negative scaleX previously so that we can adjust the rotation and skewX accordingly. Otherwise, if we always interpret a flipped matrix as affecting scaleY and the user only wants to tween the scaleX on multiple sequential tweens, it would keep the negative scaleY without that being the user's intent.
					min = 0.00002,
					rnd = 100000,
					minAngle = 179.99,
					minPI = minAngle * _DEG2RAD,
					zOrigin = _supports3D ? parseFloat(_getStyle(t, _transformOriginProp, cs, false, "0 0 0").split(" ")[2]) || tm.zOrigin  || 0 : 0,
					defaultTransformPerspective = parseFloat(CSSPlugin.defaultTransformPerspective) || 0,
					isDefault, s, m, i, n, dec, scaleX, scaleY, rotation, skewX;
				if (_transformProp) {
					s = _getStyle(t, _transformPropCSS, cs, true);
				} else if (t.currentStyle) {
					//for older versions of IE, we need to interpret the filter portion that is in the format: progid:DXImageTransform.Microsoft.Matrix(M11=6.123233995736766e-17, M12=-1, M21=1, M22=6.123233995736766e-17, sizingMethod='auto expand') Notice that we need to swap b and c compared to a normal matrix.
					s = t.currentStyle.filter.match(_ieGetMatrixExp);
					s = (s && s.length === 4) ? [s[0].substr(4), Number(s[2].substr(4)), Number(s[1].substr(4)), s[3].substr(4), (tm.x || 0), (tm.y || 0)].join(",") : "";
				}
				isDefault = (!s || s === "none" || s === "matrix(1, 0, 0, 1, 0, 0)");
				tm.svg = !!(_SVGElement && typeof(t.getBBox) === "function" && t.getCTM && (!t.parentNode || (t.parentNode.getBBox && t.parentNode.getCTM))); //don't just rely on "instanceof _SVGElement" because if the SVG is embedded via an object tag, it won't work (SVGElement is mapped to a different object)
				if (tm.svg) {
					_parseSVGOrigin(t, _getStyle(t, _transformOriginProp, _cs, false, "50% 50%") + "", tm);
					_useSVGTransformAttr = CSSPlugin.useSVGTransformAttr || _forceSVGTransformAttr;
					m = t.getAttribute("transform");
					if (isDefault && m && m.indexOf("matrix") !== -1) { //just in case there's a "transfom" value specified as an attribute instead of CSS style. Only accept a matrix, though.
						s = m;
						isDefault = 0;
					}
				}
				if (!isDefault) {
					//split the matrix values out into an array (m for matrix)
					m = (s || "").match(/(?:\-|\b)[\d\-\.e]+\b/gi) || [];
					i = m.length;
					while (--i > -1) {
						n = Number(m[i]);
						m[i] = (dec = n - (n |= 0)) ? ((dec * rnd + (dec < 0 ? -0.5 : 0.5)) | 0) / rnd + n : n; //convert strings to Numbers and round to 5 decimal places to avoid issues with tiny numbers. Roughly 20x faster than Number.toFixed(). We also must make sure to round before dividing so that values like 0.9999999999 become 1 to avoid glitches in browser rendering and interpretation of flipped/rotated 3D matrices. And don't just multiply the number by rnd, floor it, and then divide by rnd because the bitwise operations max out at a 32-bit signed integer, thus it could get clipped at a relatively low value (like 22,000.00000 for example).
					}
					if (m.length === 16) {

						//we'll only look at these position-related 6 variables first because if x/y/z all match, it's relatively safe to assume we don't need to re-parse everything which risks losing important rotational information (like rotationX:180 plus rotationY:180 would look the same as rotation:180 - there's no way to know for sure which direction was taken based solely on the matrix3d() values)
						var a13 = m[8], a23 = m[9], a33 = m[10],
							a14 = m[12], a24 = m[13], a34 = m[14];

						//we manually compensate for non-zero z component of transformOrigin to work around bugs in Safari
						if (tm.zOrigin) {
							a34 = -tm.zOrigin;
							a14 = a13*a34-m[12];
							a24 = a23*a34-m[13];
							a34 = a33*a34+tm.zOrigin-m[14];
						}
						var a11 = m[0], a21 = m[1], a31 = m[2], a41 = m[3],
							a12 = m[4], a22 = m[5], a32 = m[6], a42 = m[7],
							a43 = m[11],
							angle = Math.atan2(a21, a22),
							t1, t2, t3, cos, sin;

						//rotation
						tm.rotation = angle * _RAD2DEG;
						if (angle) {
							cos = Math.cos(-angle);
							sin = Math.sin(-angle);
							a11 = a11*cos+a12*sin;
							t2 = a21*cos+a22*sin;
							a22 = a21*-sin+a22*cos;
							a32 = a31*-sin+a32*cos;
							a21 = t2;
						}

						//rotationY
						angle = Math.atan2(a13, a11);
						tm.rotationY = angle * _RAD2DEG;
						if (angle) {
							cos = Math.cos(-angle);
							sin = Math.sin(-angle);
							t1 = a11*cos-a13*sin;
							t2 = a21*cos-a23*sin;
							t3 = a31*cos-a33*sin;
							a23 = a21*sin+a23*cos;
							a33 = a31*sin+a33*cos;
							a43 = a41*sin+a43*cos;
							a11 = t1;
							a21 = t2;
							a31 = t3;
						}

						//rotationX
						angle = Math.atan2(a32, a33);
						tm.rotationX = angle * _RAD2DEG;
						if (angle) {
							cos = Math.cos(-angle);
							sin = Math.sin(-angle);
							t1 = a12*cos+a13*sin;
							t2 = a22*cos+a23*sin;
							t3 = a32*cos+a33*sin;
							a13 = a12*-sin+a13*cos;
							a23 = a22*-sin+a23*cos;
							a33 = a32*-sin+a33*cos;
							a43 = a42*-sin+a43*cos;
							a12 = t1;
							a22 = t2;
							a32 = t3;
						}

						tm.scaleX = ((Math.sqrt(a11 * a11 + a21 * a21) * rnd + 0.5) | 0) / rnd;
						tm.scaleY = ((Math.sqrt(a22 * a22 + a23 * a23) * rnd + 0.5) | 0) / rnd;
						tm.scaleZ = ((Math.sqrt(a32 * a32 + a33 * a33) * rnd + 0.5) | 0) / rnd;
						tm.skewX = 0;
						tm.perspective = a43 ? 1 / ((a43 < 0) ? -a43 : a43) : 0;
						tm.x = a14;
						tm.y = a24;
						tm.z = a34;

					} else if ((!_supports3D || parse || !m.length || tm.x !== m[4] || tm.y !== m[5] || (!tm.rotationX && !tm.rotationY)) && !(tm.x !== undefined && _getStyle(t, "display", cs) === "none")) { //sometimes a 6-element matrix is returned even when we performed 3D transforms, like if rotationX and rotationY are 180. In cases like this, we still need to honor the 3D transforms. If we just rely on the 2D info, it could affect how the data is interpreted, like scaleY might get set to -1 or rotation could get offset by 180 degrees. For example, do a TweenLite.to(element, 1, {css:{rotationX:180, rotationY:180}}) and then later, TweenLite.to(element, 1, {css:{rotationX:0}}) and without this conditional logic in place, it'd jump to a state of being unrotated when the 2nd tween starts. Then again, we need to honor the fact that the user COULD alter the transforms outside of CSSPlugin, like by manually applying new css, so we try to sense that by looking at x and y because if those changed, we know the changes were made outside CSSPlugin and we force a reinterpretation of the matrix values. Also, in Webkit browsers, if the element's "display" is "none", its calculated style value will always return empty, so if we've already recorded the values in the _gsTransform object, we'll just rely on those.
						var k = (m.length >= 6),
							a = k ? m[0] : 1,
							b = m[1] || 0,
							c = m[2] || 0,
							d = k ? m[3] : 1;
						tm.x = m[4] || 0;
						tm.y = m[5] || 0;
						scaleX = Math.sqrt(a * a + b * b);
						scaleY = Math.sqrt(d * d + c * c);
						rotation = (a || b) ? Math.atan2(b, a) * _RAD2DEG : tm.rotation || 0; //note: if scaleX is 0, we cannot accurately measure rotation. Same for skewX with a scaleY of 0. Therefore, we default to the previously recorded value (or zero if that doesn't exist).
						skewX = (c || d) ? Math.atan2(c, d) * _RAD2DEG + rotation : tm.skewX || 0;
						if (Math.abs(skewX) > 90 && Math.abs(skewX) < 270) {
							if (invX) {
								scaleX *= -1;
								skewX += (rotation <= 0) ? 180 : -180;
								rotation += (rotation <= 0) ? 180 : -180;
							} else {
								scaleY *= -1;
								skewX += (skewX <= 0) ? 180 : -180;
							}
						}
						tm.scaleX = scaleX;
						tm.scaleY = scaleY;
						tm.rotation = rotation;
						tm.skewX = skewX;
						if (_supports3D) {
							tm.rotationX = tm.rotationY = tm.z = 0;
							tm.perspective = defaultTransformPerspective;
							tm.scaleZ = 1;
						}
					}
					tm.zOrigin = zOrigin;
					//some browsers have a hard time with very small values like 2.4492935982947064e-16 (notice the "e-" towards the end) and would render the object slightly off. So we round to 0 in these cases. The conditional logic here is faster than calling Math.abs(). Also, browsers tend to render a SLIGHTLY rotated object in a fuzzy way, so we need to snap to exactly 0 when appropriate.
					for (i in tm) {
						if (tm[i] < min) if (tm[i] > -min) {
							tm[i] = 0;
						}
					}
				}
				//DEBUG: _log("parsed rotation: "+(tm.rotationX)+", "+(tm.rotationY)+", "+(tm.rotation)+", scale: "+tm.scaleX+", "+tm.scaleY+", "+tm.scaleZ+", position: "+tm.x+", "+tm.y+", "+tm.z+", perspective: "+tm.perspective);
				if (rec) {
					t._gsTransform = tm; //record to the object's _gsTransform which we use so that tweens can control individual properties independently (we need all the properties to accurately recompose the matrix in the setRatio() method)
				}
				return tm;
			},

			//for setting 2D transforms in IE6, IE7, and IE8 (must use a "filter" to emulate the behavior of modern day browser transforms)
			_setIETransformRatio = function(v) {
				var t = this.data, //refers to the element's _gsTransform object
					ang = -t.rotation * _DEG2RAD,
					skew = ang + t.skewX * _DEG2RAD,
					rnd = 100000,
					a = ((Math.cos(ang) * t.scaleX * rnd) | 0) / rnd,
					b = ((Math.sin(ang) * t.scaleX * rnd) | 0) / rnd,
					c = ((Math.sin(skew) * -t.scaleY * rnd) | 0) / rnd,
					d = ((Math.cos(skew) * t.scaleY * rnd) | 0) / rnd,
					style = this.t.style,
					cs = this.t.currentStyle,
					filters, val;
				if (!cs) {
					return;
				}
				val = b; //just for swapping the variables an inverting them (reused "val" to avoid creating another variable in memory). IE's filter matrix uses a non-standard matrix configuration (angle goes the opposite way, and b and c are reversed and inverted)
				b = -c;
				c = -val;
				filters = cs.filter;
				style.filter = ""; //remove filters so that we can accurately measure offsetWidth/offsetHeight
				var w = this.t.offsetWidth,
					h = this.t.offsetHeight,
					clip = (cs.position !== "absolute"),
					m = "progid:DXImageTransform.Microsoft.Matrix(M11=" + a + ", M12=" + b + ", M21=" + c + ", M22=" + d,
					ox = t.x + (w * t.xPercent / 100),
					oy = t.y + (h * t.yPercent / 100),
					dx, dy;

				//if transformOrigin is being used, adjust the offset x and y
				if (t.ox != null) {
					dx = ((t.oxp) ? w * t.ox * 0.01 : t.ox) - w / 2;
					dy = ((t.oyp) ? h * t.oy * 0.01 : t.oy) - h / 2;
					ox += dx - (dx * a + dy * b);
					oy += dy - (dx * c + dy * d);
				}

				if (!clip) {
					m += ", sizingMethod='auto expand')";
				} else {
					dx = (w / 2);
					dy = (h / 2);
					//translate to ensure that transformations occur around the correct origin (default is center).
					m += ", Dx=" + (dx - (dx * a + dy * b) + ox) + ", Dy=" + (dy - (dx * c + dy * d) + oy) + ")";
				}
				if (filters.indexOf("DXImageTransform.Microsoft.Matrix(") !== -1) {
					style.filter = filters.replace(_ieSetMatrixExp, m);
				} else {
					style.filter = m + " " + filters; //we must always put the transform/matrix FIRST (before alpha(opacity=xx)) to avoid an IE bug that slices part of the object when rotation is applied with alpha.
				}

				//at the end or beginning of the tween, if the matrix is normal (1, 0, 0, 1) and opacity is 100 (or doesn't exist), remove the filter to improve browser performance.
				if (v === 0 || v === 1) if (a === 1) if (b === 0) if (c === 0) if (d === 1) if (!clip || m.indexOf("Dx=0, Dy=0") !== -1) if (!_opacityExp.test(filters) || parseFloat(RegExp.$1) === 100) if (filters.indexOf("gradient(" && filters.indexOf("Alpha")) === -1) {
					style.removeAttribute("filter");
				}

				//we must set the margins AFTER applying the filter in order to avoid some bugs in IE8 that could (in rare scenarios) cause them to be ignored intermittently (vibration).
				if (!clip) {
					var mult = (_ieVers < 8) ? 1 : -1, //in Internet Explorer 7 and before, the box model is broken, causing the browser to treat the width/height of the actual rotated filtered image as the width/height of the box itself, but Microsoft corrected that in IE8. We must use a negative offset in IE8 on the right/bottom
						marg, prop, dif;
					dx = t.ieOffsetX || 0;
					dy = t.ieOffsetY || 0;
					t.ieOffsetX = Math.round((w - ((a < 0 ? -a : a) * w + (b < 0 ? -b : b) * h)) / 2 + ox);
					t.ieOffsetY = Math.round((h - ((d < 0 ? -d : d) * h + (c < 0 ? -c : c) * w)) / 2 + oy);
					for (i = 0; i < 4; i++) {
						prop = _margins[i];
						marg = cs[prop];
						//we need to get the current margin in case it is being tweened separately (we want to respect that tween's changes)
						val = (marg.indexOf("px") !== -1) ? parseFloat(marg) : _convertToPixels(this.t, prop, parseFloat(marg), marg.replace(_suffixExp, "")) || 0;
						if (val !== t[prop]) {
							dif = (i < 2) ? -t.ieOffsetX : -t.ieOffsetY; //if another tween is controlling a margin, we cannot only apply the difference in the ieOffsets, so we essentially zero-out the dx and dy here in that case. We record the margin(s) later so that we can keep comparing them, making this code very flexible.
						} else {
							dif = (i < 2) ? dx - t.ieOffsetX : dy - t.ieOffsetY;
						}
						style[prop] = (t[prop] = Math.round( val - dif * ((i === 0 || i === 2) ? 1 : mult) )) + "px";
					}
				}
			},

			_set3DTransformRatio = _internals.set3DTransformRatio = function(v) {
				var t = this.data, //refers to the element's _gsTransform object
					style = this.t.style,
					angle = t.rotation * _DEG2RAD,
					sx = t.scaleX,
					sy = t.scaleY,
					sz = t.scaleZ,
					x = t.x,
					y = t.y,
					z = t.z,
					perspective = t.perspective,
					a11, a12, a13, a14,	a21, a22, a23, a24, a31, a32, a33, a34,	a41, a42, a43,
					zOrigin, rnd, cos, sin, t1, t2, t3, t4, transform, comma;
				if (v === 1 || v === 0) if (t.force3D === "auto") if (!t.rotationY && !t.rotationX && sz === 1 && !perspective && !z) { //on the final render (which could be 0 for a from tween), if there are no 3D aspects, render in 2D to free up memory and improve performance especially on mobile devices
					_set2DTransformRatio.call(this, v);
					return;
				}
				if (_isFirefox) {
					var n = 0.0001;
					if (sx < n && sx > -n) { //Firefox has a bug (at least in v25) that causes it to render the transparent part of 32-bit PNG images as black when displayed inside an iframe and the 3D scale is very small and doesn't change sufficiently enough between renders (like if you use a Power4.easeInOut to scale from 0 to 1 where the beginning values only change a tiny amount to begin the tween before accelerating). In this case, we force the scale to be 0.00002 instead which is visually the same but works around the Firefox issue.
						sx = sz = 0.00002;
					}
					if (sy < n && sy > -n) {
						sy = sz = 0.00002;
					}
					if (perspective && !t.z && !t.rotationX && !t.rotationY) { //Firefox has a bug that causes elements to have an odd super-thin, broken/dotted black border on elements that have a perspective set but aren't utilizing 3D space (no rotationX, rotationY, or z).
						perspective = 0;
					}
				}
				if (angle || t.skewX) {
					cos = Math.cos(angle);
					sin = Math.sin(angle);
					a11 = cos;
					a21 = sin;
					if (t.skewX) {
						angle -= t.skewX * _DEG2RAD;
						cos = Math.cos(angle);
						sin = Math.sin(angle);
						if (t.skewType === "simple") { //by default, we compensate skewing on the other axis to make it look more natural, but you can set the skewType to "simple" to use the uncompensated skewing that CSS does
							t1 = Math.tan(t.skewX * _DEG2RAD);
							t1 = Math.sqrt(1 + t1 * t1);
							cos *= t1;
							sin *= t1;
						}
					}
					a12 = -sin;
					a22 = cos;

				} else if (!t.rotationY && !t.rotationX && sz === 1 && !perspective && !t.svg) { //if we're only translating and/or 2D scaling, this is faster...
					style[_transformProp] = ((t.xPercent || t.yPercent) ? "translate(" + t.xPercent + "%," + t.yPercent + "%) translate3d(" : "translate3d(") + x + "px," + y + "px," + z +"px)" + ((sx !== 1 || sy !== 1) ? " scale(" + sx + "," + sy + ")" : "");
					return;
				} else {
					a11 = a22 = 1;
					a12 = a21 = 0;
				}
				a33 = 1;
				a13 = a14 = a23 = a24 = a31 = a32 = a34 = a41 = a42 = 0;
				a43 = (perspective) ? -1 / perspective : 0;
				zOrigin = t.zOrigin;
				rnd = 100000;
				comma = ",";
				angle = t.rotationY * _DEG2RAD;
				if (angle) {
					cos = Math.cos(angle);
					sin = Math.sin(angle);
					a31 = a33*-sin;
					a41 = a43*-sin;
					a13 = a11*sin;
					a23 = a21*sin;
					a33 *= cos;
					a43 *= cos;
					a11 *= cos;
					a21 *= cos;
				}
				angle = t.rotationX * _DEG2RAD;
				if (angle) {
					cos = Math.cos(angle);
					sin = Math.sin(angle);
					t1 = a12*cos+a13*sin;
					t2 = a22*cos+a23*sin;
					t3 = a32*cos+a33*sin;
					t4 = a42*cos+a43*sin;
					a13 = a12*-sin+a13*cos;
					a23 = a22*-sin+a23*cos;
					a33 = a32*-sin+a33*cos;
					a43 = a42*-sin+a43*cos;
					a12 = t1;
					a22 = t2;
					a32 = t3;
					a42 = t4;
				}
				if (sz !== 1) {
					a13*=sz;
					a23*=sz;
					a33*=sz;
					a43*=sz;
				}
				if (sy !== 1) {
					a12*=sy;
					a22*=sy;
					a32*=sy;
					a42*=sy;
				}
				if (sx !== 1) {
					a11*=sx;
					a21*=sx;
					a31*=sx;
					a41*=sx;
				}
				if (zOrigin) {
					a34 -= zOrigin;
					a14 = a13*a34;
					a24 = a23*a34;
					a34 = a33*a34+zOrigin;
				}
				if (t.svg) { //due to bugs in some browsers, we need to manage the transform-origin of SVG manually
					a14 += t.xOrigin - (t.xOrigin * a11 + t.yOrigin * a12);
					a24 += t.yOrigin - (t.xOrigin * a21 + t.yOrigin * a22);
				}
				//we round the x, y, and z slightly differently to allow even larger values.
				a14 = (t1 = (a14 += x) - (a14 |= 0)) ? ((t1 * rnd + (t1 < 0 ? -0.5 : 0.5)) | 0) / rnd + a14 : a14;
				a24 = (t1 = (a24 += y) - (a24 |= 0)) ? ((t1 * rnd + (t1 < 0 ? -0.5 : 0.5)) | 0) / rnd + a24 : a24;
				a34 = (t1 = (a34 += z) - (a34 |= 0)) ? ((t1 * rnd + (t1 < 0 ? -0.5 : 0.5)) | 0) / rnd + a34 : a34;

				//optimized way of concatenating all the values into a string. If we do it all in one shot, it's slower because of the way browsers have to create temp strings and the way it affects memory. If we do it piece-by-piece with +=, it's a bit slower too. We found that doing it in these sized chunks works best overall:
				transform = ((t.xPercent || t.yPercent) ? "translate(" + t.xPercent + "%," + t.yPercent + "%) matrix3d(" : "matrix3d(");
				transform += ((a11 * rnd) | 0) / rnd + comma + ((a21 * rnd) | 0) / rnd + comma + ((a31 * rnd) | 0) / rnd;
				transform += comma + ((a41 * rnd) | 0) / rnd + comma + ((a12 * rnd) | 0) / rnd + comma + ((a22 * rnd) | 0) / rnd;
				transform += comma + ((a32 * rnd) | 0) / rnd + comma + ((a42 * rnd) | 0) / rnd + comma + ((a13 * rnd) | 0) / rnd;
				transform += comma + ((a23 * rnd) | 0) / rnd + comma + ((a33 * rnd) | 0) / rnd + comma + ((a43 * rnd) | 0) / rnd;
				transform += comma + a14 + comma + a24 + comma + a34 + comma + (perspective ? (1 + (-a34 / perspective)) : 1) + ")";
				style[_transformProp] = transform;

				//OLD (slower on most devices): style[_transformProp] = ((t.xPercent || t.yPercent) ? "translate(" + t.xPercent + "%," + t.yPercent + "%) matrix3d(" : "matrix3d(") + [ (((a11 * rnd) | 0) / rnd), (((a21 * rnd) | 0) / rnd), (((a31 * rnd) | 0) / rnd), (((a41 * rnd) | 0) / rnd), (((a12 * rnd) | 0) / rnd), (((a22 * rnd) | 0) / rnd), (((a32 * rnd) | 0) / rnd), (((a42 * rnd) | 0) / rnd), (((a13 * rnd) | 0) / rnd), (((a23 * rnd) | 0) / rnd), (((a33 * rnd) | 0) / rnd), (((a43 * rnd) | 0) / rnd), a14, a24, a34, (perspective ? (1 + (-a34 / perspective)) : 1) ].join(",") + ")";
			},

			_set2DTransformRatio = _internals.set2DTransformRatio = function(v) {
				var t = this.data, //refers to the element's _gsTransform object
					targ = this.t,
					style = targ.style,
					x = t.x,
					y = t.y,
					ang, skew, rnd, sx, sy, a, b, c, d, matrix, min;
				if ((t.rotationX || t.rotationY || t.z || t.force3D === true || (t.force3D === "auto" && v !== 1 && v !== 0)) && !(t.svg && _useSVGTransformAttr) && _supports3D) { //if a 3D tween begins while a 2D one is running, we need to kick the rendering over to the 3D method. For example, imagine a yoyo-ing, infinitely repeating scale tween running, and then the object gets rotated in 3D space with a different tween.
					this.setRatio = _set3DTransformRatio;
					_set3DTransformRatio.call(this, v);
					return;
				}
				sx = t.scaleX;
				sy = t.scaleY;
				if (t.rotation || t.skewX || t.svg) {
					ang = t.rotation * _DEG2RAD;
					skew = ang - t.skewX * _DEG2RAD;
					rnd = 100000;
					a = Math.cos(ang) * sx;
					b = Math.sin(ang) * sx;
					c = Math.sin(skew) * -sy;
					d = Math.cos(skew) * sy;
					if (t.svg) {
						x += t.xOrigin - (t.xOrigin * a + t.yOrigin * c);
						y += t.yOrigin - (t.xOrigin * b + t.yOrigin * d);
						min = 0.000001;
						if (x < min) if (x > -min) {
							x = 0;
						}
						if (y < min) if (y > -min) {
							y = 0;
						}
					}
					matrix = (((a * rnd) | 0) / rnd) + "," + (((b * rnd) | 0) / rnd) + "," + (((c * rnd) | 0) / rnd) + "," + (((d * rnd) | 0) / rnd) + "," + x + "," + y + ")";
					if (t.svg && _useSVGTransformAttr) {
						targ.setAttribute("transform", "matrix(" + matrix);
					} else {
						//some browsers have a hard time with very small values like 2.4492935982947064e-16 (notice the "e-" towards the end) and would render the object slightly off. So we round to 5 decimal places.
						style[_transformProp] = ((t.xPercent || t.yPercent) ? "translate(" + t.xPercent + "%," + t.yPercent + "%) matrix(" : "matrix(") + matrix;
					}
				} else {
					style[_transformProp] = ((t.xPercent || t.yPercent) ? "translate(" + t.xPercent + "%," + t.yPercent + "%) matrix(" : "matrix(") + sx + ",0,0," + sy + "," + x + "," + y + ")";
				}
			};

		p = Transform.prototype;
		p.x = p.y = p.z = p.skewX = p.skewY = p.rotation = p.rotationX = p.rotationY = p.zOrigin = p.xPercent = p.yPercent = 0;
		p.scaleX = p.scaleY = p.scaleZ = 1;

		_registerComplexSpecialProp("transform,scale,scaleX,scaleY,scaleZ,x,y,z,rotation,rotationX,rotationY,rotationZ,skewX,skewY,shortRotation,shortRotationX,shortRotationY,shortRotationZ,transformOrigin,transformPerspective,directionalRotation,parseTransform,force3D,skewType,xPercent,yPercent", {parser:function(t, e, p, cssp, pt, plugin, vars) {
			if (cssp._lastParsedTransform === vars) { return pt; } //only need to parse the transform once, and only if the browser supports it.
			cssp._lastParsedTransform = vars;
			var m1 = cssp._transform = _getTransform(t, _cs, true, vars.parseTransform),
				style = t.style,
				min = 0.000001,
				i = _transformProps.length,
				v = vars,
				endRotations = {},
				m2, skewY, copy, orig, has3D, hasChange, dr;
			if (typeof(v.transform) === "string" && _transformProp) { //for values like transform:"rotate(60deg) scale(0.5, 0.8)"
				copy = _tempDiv.style; //don't use the original target because it might be SVG in which case some browsers don't report computed style correctly.
				copy[_transformProp] = v.transform;
				copy.display = "block"; //if display is "none", the browser often refuses to report the transform properties correctly.
				copy.position = "absolute";
				_doc.body.appendChild(_tempDiv);
				m2 = _getTransform(_tempDiv, null, false);
				_doc.body.removeChild(_tempDiv);
			} else if (typeof(v) === "object") { //for values like scaleX, scaleY, rotation, x, y, skewX, and skewY or transform:{...} (object)
				m2 = {scaleX:_parseVal((v.scaleX != null) ? v.scaleX : v.scale, m1.scaleX),
					scaleY:_parseVal((v.scaleY != null) ? v.scaleY : v.scale, m1.scaleY),
					scaleZ:_parseVal(v.scaleZ, m1.scaleZ),
					x:_parseVal(v.x, m1.x),
					y:_parseVal(v.y, m1.y),
					z:_parseVal(v.z, m1.z),
					xPercent:_parseVal(v.xPercent, m1.xPercent),
					yPercent:_parseVal(v.yPercent, m1.yPercent),
					perspective:_parseVal(v.transformPerspective, m1.perspective)};
				dr = v.directionalRotation;
				if (dr != null) {
					if (typeof(dr) === "object") {
						for (copy in dr) {
							v[copy] = dr[copy];
						}
					} else {
						v.rotation = dr;
					}
				}
				if (typeof(v.x) === "string" && v.x.indexOf("%") !== -1) {
					m2.x = 0;
					m2.xPercent = _parseVal(v.x, m1.xPercent);
				}
				if (typeof(v.y) === "string" && v.y.indexOf("%") !== -1) {
					m2.y = 0;
					m2.yPercent = _parseVal(v.y, m1.yPercent);
				}

				m2.rotation = _parseAngle(("rotation" in v) ? v.rotation : ("shortRotation" in v) ? v.shortRotation + "_short" : ("rotationZ" in v) ? v.rotationZ : m1.rotation, m1.rotation, "rotation", endRotations);
				if (_supports3D) {
					m2.rotationX = _parseAngle(("rotationX" in v) ? v.rotationX : ("shortRotationX" in v) ? v.shortRotationX + "_short" : m1.rotationX || 0, m1.rotationX, "rotationX", endRotations);
					m2.rotationY = _parseAngle(("rotationY" in v) ? v.rotationY : ("shortRotationY" in v) ? v.shortRotationY + "_short" : m1.rotationY || 0, m1.rotationY, "rotationY", endRotations);
				}
				m2.skewX = (v.skewX == null) ? m1.skewX : _parseAngle(v.skewX, m1.skewX);

				//note: for performance reasons, we combine all skewing into the skewX and rotation values, ignoring skewY but we must still record it so that we can discern how much of the overall skew is attributed to skewX vs. skewY. Otherwise, if the skewY would always act relative (tween skewY to 10deg, for example, multiple times and if we always combine things into skewX, we can't remember that skewY was 10 from last time). Remember, a skewY of 10 degrees looks the same as a rotation of 10 degrees plus a skewX of -10 degrees.
				m2.skewY = (v.skewY == null) ? m1.skewY : _parseAngle(v.skewY, m1.skewY);
				if ((skewY = m2.skewY - m1.skewY)) {
					m2.skewX += skewY;
					m2.rotation += skewY;
				}
			}
			if (_supports3D && v.force3D != null) {
				m1.force3D = v.force3D;
				hasChange = true;
			}

			m1.skewType = v.skewType || m1.skewType || CSSPlugin.defaultSkewType;

			has3D = (m1.force3D || m1.z || m1.rotationX || m1.rotationY || m2.z || m2.rotationX || m2.rotationY || m2.perspective);
			if (!has3D && v.scale != null) {
				m2.scaleZ = 1; //no need to tween scaleZ.
			}

			while (--i > -1) {
				p = _transformProps[i];
				orig = m2[p] - m1[p];
				if (orig > min || orig < -min || v[p] != null || _forcePT[p] != null) {
					hasChange = true;
					pt = new CSSPropTween(m1, p, m1[p], orig, pt);
					if (p in endRotations) {
						pt.e = endRotations[p]; //directional rotations typically have compensated values during the tween, but we need to make sure they end at exactly what the user requested
					}
					pt.xs0 = 0; //ensures the value stays numeric in setRatio()
					pt.plugin = plugin;
					cssp._overwriteProps.push(pt.n);
				}
			}

			orig = v.transformOrigin;
			if (orig && m1.svg) {
				_parseSVGOrigin(t, orig, m2);
				pt = new CSSPropTween(m1, "xOrigin", m1.xOrigin, m2.xOrigin - m1.xOrigin, pt, -1, "transformOrigin");
				pt.b = m1.xOrigin;
				pt.e = pt.xs0 = m2.xOrigin;
				pt = new CSSPropTween(m1, "yOrigin", m1.yOrigin, m2.yOrigin - m1.yOrigin, pt, -1, "transformOrigin");
				pt.b = m1.yOrigin;
				pt.e = pt.xs0 = m2.yOrigin;
				orig = "0px 0px"; //certain browsers (like firefox) completely botch transform-origin, so we must remove it to prevent it from contaminating transforms. We manage it ourselves with xOrigin and yOrigin
			}
			if (orig || (_supports3D && has3D && m1.zOrigin)) { //if anything 3D is happening and there's a transformOrigin with a z component that's non-zero, we must ensure that the transformOrigin's z-component is set to 0 so that we can manually do those calculations to get around Safari bugs. Even if the user didn't specifically define a "transformOrigin" in this particular tween (maybe they did it via css directly).
				if (_transformProp) {
					hasChange = true;
					p = _transformOriginProp;
					orig = (orig || _getStyle(t, p, _cs, false, "50% 50%")) + ""; //cast as string to avoid errors
					pt = new CSSPropTween(style, p, 0, 0, pt, -1, "transformOrigin");
					pt.b = style[p];
					pt.plugin = plugin;
					if (_supports3D) {
						copy = m1.zOrigin;
						orig = orig.split(" ");
						m1.zOrigin = ((orig.length > 2 && !(copy !== 0 && orig[2] === "0px")) ? parseFloat(orig[2]) : copy) || 0; //Safari doesn't handle the z part of transformOrigin correctly, so we'll manually handle it in the _set3DTransformRatio() method.
						pt.xs0 = pt.e = orig[0] + " " + (orig[1] || "50%") + " 0px"; //we must define a z value of 0px specifically otherwise iOS 5 Safari will stick with the old one (if one was defined)!
						pt = new CSSPropTween(m1, "zOrigin", 0, 0, pt, -1, pt.n); //we must create a CSSPropTween for the _gsTransform.zOrigin so that it gets reset properly at the beginning if the tween runs backward (as opposed to just setting m1.zOrigin here)
						pt.b = copy;
						pt.xs0 = pt.e = m1.zOrigin;
					} else {
						pt.xs0 = pt.e = orig;
					}

				//for older versions of IE (6-8), we need to manually calculate things inside the setRatio() function. We record origin x and y (ox and oy) and whether or not the values are percentages (oxp and oyp).
				} else {
					_parsePosition(orig + "", m1);
				}
			}
			if (hasChange) {
				cssp._transformType = (!(m1.svg && _useSVGTransformAttr) && (has3D || this._transformType === 3)) ? 3 : 2; //quicker than calling cssp._enableTransforms();
			}
			return pt;
		}, prefix:true});

		_registerComplexSpecialProp("boxShadow", {defaultValue:"0px 0px 0px 0px #999", prefix:true, color:true, multi:true, keyword:"inset"});

		_registerComplexSpecialProp("borderRadius", {defaultValue:"0px", parser:function(t, e, p, cssp, pt, plugin) {
			e = this.format(e);
			var props = ["borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius","borderBottomLeftRadius"],
				style = t.style,
				ea1, i, es2, bs2, bs, es, bn, en, w, h, esfx, bsfx, rel, hn, vn, em;
			w = parseFloat(t.offsetWidth);
			h = parseFloat(t.offsetHeight);
			ea1 = e.split(" ");
			for (i = 0; i < props.length; i++) { //if we're dealing with percentages, we must convert things separately for the horizontal and vertical axis!
				if (this.p.indexOf("border")) { //older browsers used a prefix
					props[i] = _checkPropPrefix(props[i]);
				}
				bs = bs2 = _getStyle(t, props[i], _cs, false, "0px");
				if (bs.indexOf(" ") !== -1) {
					bs2 = bs.split(" ");
					bs = bs2[0];
					bs2 = bs2[1];
				}
				es = es2 = ea1[i];
				bn = parseFloat(bs);
				bsfx = bs.substr((bn + "").length);
				rel = (es.charAt(1) === "=");
				if (rel) {
					en = parseInt(es.charAt(0)+"1", 10);
					es = es.substr(2);
					en *= parseFloat(es);
					esfx = es.substr((en + "").length - (en < 0 ? 1 : 0)) || "";
				} else {
					en = parseFloat(es);
					esfx = es.substr((en + "").length);
				}
				if (esfx === "") {
					esfx = _suffixMap[p] || bsfx;
				}
				if (esfx !== bsfx) {
					hn = _convertToPixels(t, "borderLeft", bn, bsfx); //horizontal number (we use a bogus "borderLeft" property just because the _convertToPixels() method searches for the keywords "Left", "Right", "Top", and "Bottom" to determine of it's a horizontal or vertical property, and we need "border" in the name so that it knows it should measure relative to the element itself, not its parent.
					vn = _convertToPixels(t, "borderTop", bn, bsfx); //vertical number
					if (esfx === "%") {
						bs = (hn / w * 100) + "%";
						bs2 = (vn / h * 100) + "%";
					} else if (esfx === "em") {
						em = _convertToPixels(t, "borderLeft", 1, "em");
						bs = (hn / em) + "em";
						bs2 = (vn / em) + "em";
					} else {
						bs = hn + "px";
						bs2 = vn + "px";
					}
					if (rel) {
						es = (parseFloat(bs) + en) + esfx;
						es2 = (parseFloat(bs2) + en) + esfx;
					}
				}
				pt = _parseComplex(style, props[i], bs + " " + bs2, es + " " + es2, false, "0px", pt);
			}
			return pt;
		}, prefix:true, formatter:_getFormatter("0px 0px 0px 0px", false, true)});
		_registerComplexSpecialProp("backgroundPosition", {defaultValue:"0 0", parser:function(t, e, p, cssp, pt, plugin) {
			var bp = "background-position",
				cs = (_cs || _getComputedStyle(t, null)),
				bs = this.format( ((cs) ? _ieVers ? cs.getPropertyValue(bp + "-x") + " " + cs.getPropertyValue(bp + "-y") : cs.getPropertyValue(bp) : t.currentStyle.backgroundPositionX + " " + t.currentStyle.backgroundPositionY) || "0 0"), //Internet Explorer doesn't report background-position correctly - we must query background-position-x and background-position-y and combine them (even in IE10). Before IE9, we must do the same with the currentStyle object and use camelCase
				es = this.format(e),
				ba, ea, i, pct, overlap, src;
			if ((bs.indexOf("%") !== -1) !== (es.indexOf("%") !== -1)) {
				src = _getStyle(t, "backgroundImage").replace(_urlExp, "");
				if (src && src !== "none") {
					ba = bs.split(" ");
					ea = es.split(" ");
					_tempImg.setAttribute("src", src); //set the temp IMG's src to the background-image so that we can measure its width/height
					i = 2;
					while (--i > -1) {
						bs = ba[i];
						pct = (bs.indexOf("%") !== -1);
						if (pct !== (ea[i].indexOf("%") !== -1)) {
							overlap = (i === 0) ? t.offsetWidth - _tempImg.width : t.offsetHeight - _tempImg.height;
							ba[i] = pct ? (parseFloat(bs) / 100 * overlap) + "px" : (parseFloat(bs) / overlap * 100) + "%";
						}
					}
					bs = ba.join(" ");
				}
			}
			return this.parseComplex(t.style, bs, es, pt, plugin);
		}, formatter:_parsePosition});
		_registerComplexSpecialProp("backgroundSize", {defaultValue:"0 0", formatter:_parsePosition});
		_registerComplexSpecialProp("perspective", {defaultValue:"0px", prefix:true});
		_registerComplexSpecialProp("perspectiveOrigin", {defaultValue:"50% 50%", prefix:true});
		_registerComplexSpecialProp("transformStyle", {prefix:true});
		_registerComplexSpecialProp("backfaceVisibility", {prefix:true});
		_registerComplexSpecialProp("userSelect", {prefix:true});
		_registerComplexSpecialProp("margin", {parser:_getEdgeParser("marginTop,marginRight,marginBottom,marginLeft")});
		_registerComplexSpecialProp("padding", {parser:_getEdgeParser("paddingTop,paddingRight,paddingBottom,paddingLeft")});
		_registerComplexSpecialProp("clip", {defaultValue:"rect(0px,0px,0px,0px)", parser:function(t, e, p, cssp, pt, plugin){
			var b, cs, delim;
			if (_ieVers < 9) { //IE8 and earlier don't report a "clip" value in the currentStyle - instead, the values are split apart into clipTop, clipRight, clipBottom, and clipLeft. Also, in IE7 and earlier, the values inside rect() are space-delimited, not comma-delimited.
				cs = t.currentStyle;
				delim = _ieVers < 8 ? " " : ",";
				b = "rect(" + cs.clipTop + delim + cs.clipRight + delim + cs.clipBottom + delim + cs.clipLeft + ")";
				e = this.format(e).split(",").join(delim);
			} else {
				b = this.format(_getStyle(t, this.p, _cs, false, this.dflt));
				e = this.format(e);
			}
			return this.parseComplex(t.style, b, e, pt, plugin);
		}});
		_registerComplexSpecialProp("textShadow", {defaultValue:"0px 0px 0px #999", color:true, multi:true});
		_registerComplexSpecialProp("autoRound,strictUnits", {parser:function(t, e, p, cssp, pt) {return pt;}}); //just so that we can ignore these properties (not tween them)
		_registerComplexSpecialProp("border", {defaultValue:"0px solid #000", parser:function(t, e, p, cssp, pt, plugin) {
				return this.parseComplex(t.style, this.format(_getStyle(t, "borderTopWidth", _cs, false, "0px") + " " + _getStyle(t, "borderTopStyle", _cs, false, "solid") + " " + _getStyle(t, "borderTopColor", _cs, false, "#000")), this.format(e), pt, plugin);
			}, color:true, formatter:function(v) {
				var a = v.split(" ");
				return a[0] + " " + (a[1] || "solid") + " " + (v.match(_colorExp) || ["#000"])[0];
			}});
		_registerComplexSpecialProp("borderWidth", {parser:_getEdgeParser("borderTopWidth,borderRightWidth,borderBottomWidth,borderLeftWidth")}); //Firefox doesn't pick up on borderWidth set in style sheets (only inline).
		_registerComplexSpecialProp("float,cssFloat,styleFloat", {parser:function(t, e, p, cssp, pt, plugin) {
			var s = t.style,
				prop = ("cssFloat" in s) ? "cssFloat" : "styleFloat";
			return new CSSPropTween(s, prop, 0, 0, pt, -1, p, false, 0, s[prop], e);
		}});

		//opacity-related
		var _setIEOpacityRatio = function(v) {
				var t = this.t, //refers to the element's style property
					filters = t.filter || _getStyle(this.data, "filter") || "",
					val = (this.s + this.c * v) | 0,
					skip;
				if (val === 100) { //for older versions of IE that need to use a filter to apply opacity, we should remove the filter if opacity hits 1 in order to improve performance, but make sure there isn't a transform (matrix) or gradient in the filters.
					if (filters.indexOf("atrix(") === -1 && filters.indexOf("radient(") === -1 && filters.indexOf("oader(") === -1) {
						t.removeAttribute("filter");
						skip = (!_getStyle(this.data, "filter")); //if a class is applied that has an alpha filter, it will take effect (we don't want that), so re-apply our alpha filter in that case. We must first remove it and then check.
					} else {
						t.filter = filters.replace(_alphaFilterExp, "");
						skip = true;
					}
				}
				if (!skip) {
					if (this.xn1) {
						t.filter = filters = filters || ("alpha(opacity=" + val + ")"); //works around bug in IE7/8 that prevents changes to "visibility" from being applied properly if the filter is changed to a different alpha on the same frame.
					}
					if (filters.indexOf("pacity") === -1) { //only used if browser doesn't support the standard opacity style property (IE 7 and 8). We omit the "O" to avoid case-sensitivity issues
						if (val !== 0 || !this.xn1) { //bugs in IE7/8 won't render the filter properly if opacity is ADDED on the same frame/render as "visibility" changes (this.xn1 is 1 if this tween is an "autoAlpha" tween)
							t.filter = filters + " alpha(opacity=" + val + ")"; //we round the value because otherwise, bugs in IE7/8 can prevent "visibility" changes from being applied properly.
						}
					} else {
						t.filter = filters.replace(_opacityExp, "opacity=" + val);
					}
				}
			};
		_registerComplexSpecialProp("opacity,alpha,autoAlpha", {defaultValue:"1", parser:function(t, e, p, cssp, pt, plugin) {
			var b = parseFloat(_getStyle(t, "opacity", _cs, false, "1")),
				style = t.style,
				isAutoAlpha = (p === "autoAlpha");
			if (typeof(e) === "string" && e.charAt(1) === "=") {
				e = ((e.charAt(0) === "-") ? -1 : 1) * parseFloat(e.substr(2)) + b;
			}
			if (isAutoAlpha && b === 1 && _getStyle(t, "visibility", _cs) === "hidden" && e !== 0) { //if visibility is initially set to "hidden", we should interpret that as intent to make opacity 0 (a convenience)
				b = 0;
			}
			if (_supportsOpacity) {
				pt = new CSSPropTween(style, "opacity", b, e - b, pt);
			} else {
				pt = new CSSPropTween(style, "opacity", b * 100, (e - b) * 100, pt);
				pt.xn1 = isAutoAlpha ? 1 : 0; //we need to record whether or not this is an autoAlpha so that in the setRatio(), we know to duplicate the setting of the alpha in order to work around a bug in IE7 and IE8 that prevents changes to "visibility" from taking effect if the filter is changed to a different alpha(opacity) at the same time. Setting it to the SAME value first, then the new value works around the IE7/8 bug.
				style.zoom = 1; //helps correct an IE issue.
				pt.type = 2;
				pt.b = "alpha(opacity=" + pt.s + ")";
				pt.e = "alpha(opacity=" + (pt.s + pt.c) + ")";
				pt.data = t;
				pt.plugin = plugin;
				pt.setRatio = _setIEOpacityRatio;
			}
			if (isAutoAlpha) { //we have to create the "visibility" PropTween after the opacity one in the linked list so that they run in the order that works properly in IE8 and earlier
				pt = new CSSPropTween(style, "visibility", 0, 0, pt, -1, null, false, 0, ((b !== 0) ? "inherit" : "hidden"), ((e === 0) ? "hidden" : "inherit"));
				pt.xs0 = "inherit";
				cssp._overwriteProps.push(pt.n);
				cssp._overwriteProps.push(p);
			}
			return pt;
		}});


		var _removeProp = function(s, p) {
				if (p) {
					if (s.removeProperty) {
						if (p.substr(0,2) === "ms") { //Microsoft browsers don't conform to the standard of capping the first prefix character, so we adjust so that when we prefix the caps with a dash, it's correct (otherwise it'd be "ms-transform" instead of "-ms-transform" for IE9, for example)
							p = "M" + p.substr(1);
						}
						s.removeProperty(p.replace(_capsExp, "-$1").toLowerCase());
					} else { //note: old versions of IE use "removeAttribute()" instead of "removeProperty()"
						s.removeAttribute(p);
					}
				}
			},
			_setClassNameRatio = function(v) {
				this.t._gsClassPT = this;
				if (v === 1 || v === 0) {
					this.t.setAttribute("class", (v === 0) ? this.b : this.e);
					var mpt = this.data, //first MiniPropTween
						s = this.t.style;
					while (mpt) {
						if (!mpt.v) {
							_removeProp(s, mpt.p);
						} else {
							s[mpt.p] = mpt.v;
						}
						mpt = mpt._next;
					}
					if (v === 1 && this.t._gsClassPT === this) {
						this.t._gsClassPT = null;
					}
				} else if (this.t.getAttribute("class") !== this.e) {
					this.t.setAttribute("class", this.e);
				}
			};
		_registerComplexSpecialProp("className", {parser:function(t, e, p, cssp, pt, plugin, vars) {
			var b = t.getAttribute("class") || "", //don't use t.className because it doesn't work consistently on SVG elements; getAttribute("class") and setAttribute("class", value") is more reliable.
				cssText = t.style.cssText,
				difData, bs, cnpt, cnptLookup, mpt;
			pt = cssp._classNamePT = new CSSPropTween(t, p, 0, 0, pt, 2);
			pt.setRatio = _setClassNameRatio;
			pt.pr = -11;
			_hasPriority = true;
			pt.b = b;
			bs = _getAllStyles(t, _cs);
			//if there's a className tween already operating on the target, force it to its end so that the necessary inline styles are removed and the class name is applied before we determine the end state (we don't want inline styles interfering that were there just for class-specific values)
			cnpt = t._gsClassPT;
			if (cnpt) {
				cnptLookup = {};
				mpt = cnpt.data; //first MiniPropTween which stores the inline styles - we need to force these so that the inline styles don't contaminate things. Otherwise, there's a small chance that a tween could start and the inline values match the destination values and they never get cleaned.
				while (mpt) {
					cnptLookup[mpt.p] = 1;
					mpt = mpt._next;
				}
				cnpt.setRatio(1);
			}
			t._gsClassPT = pt;
			pt.e = (e.charAt(1) !== "=") ? e : b.replace(new RegExp("\\s*\\b" + e.substr(2) + "\\b"), "") + ((e.charAt(0) === "+") ? " " + e.substr(2) : "");
			if (cssp._tween._duration) { //if it's a zero-duration tween, there's no need to tween anything or parse the data. In fact, if we switch classes temporarily (which we must do for proper parsing) and the class has a transition applied, it could cause a quick flash to the end state and back again initially in some browsers.
				t.setAttribute("class", pt.e);
				difData = _cssDif(t, bs, _getAllStyles(t), vars, cnptLookup);
				t.setAttribute("class", b);
				pt.data = difData.firstMPT;
				t.style.cssText = cssText; //we recorded cssText before we swapped classes and ran _getAllStyles() because in cases when a className tween is overwritten, we remove all the related tweening properties from that class change (otherwise class-specific stuff can't override properties we've directly set on the target's style object due to specificity).
				pt = pt.xfirst = cssp.parse(t, difData.difs, pt, plugin); //we record the CSSPropTween as the xfirst so that we can handle overwriting propertly (if "className" gets overwritten, we must kill all the properties associated with the className part of the tween, so we can loop through from xfirst to the pt itself)
			}
			return pt;
		}});


		var _setClearPropsRatio = function(v) {
			if (v === 1 || v === 0) if (this.data._totalTime === this.data._totalDuration && this.data.data !== "isFromStart") { //this.data refers to the tween. Only clear at the END of the tween (remember, from() tweens make the ratio go from 1 to 0, so we can't just check that and if the tween is the zero-duration one that's created internally to render the starting values in a from() tween, ignore that because otherwise, for example, from(...{height:100, clearProps:"height", delay:1}) would wipe the height at the beginning of the tween and after 1 second, it'd kick back in).
				var s = this.t.style,
					transformParse = _specialProps.transform.parse,
					a, p, i, clearTransform;
				if (this.e === "all") {
					s.cssText = "";
					clearTransform = true;
				} else {
					a = this.e.split(" ").join("").split(",");
					i = a.length;
					while (--i > -1) {
						p = a[i];
						if (_specialProps[p]) {
							if (_specialProps[p].parse === transformParse) {
								clearTransform = true;
							} else {
								p = (p === "transformOrigin") ? _transformOriginProp : _specialProps[p].p; //ensures that special properties use the proper browser-specific property name, like "scaleX" might be "-webkit-transform" or "boxShadow" might be "-moz-box-shadow"
							}
						}
						_removeProp(s, p);
					}
				}
				if (clearTransform) {
					_removeProp(s, _transformProp);
					if (this.t._gsTransform) {
						delete this.t._gsTransform;
					}
				}

			}
		};
		_registerComplexSpecialProp("clearProps", {parser:function(t, e, p, cssp, pt) {
			pt = new CSSPropTween(t, p, 0, 0, pt, 2);
			pt.setRatio = _setClearPropsRatio;
			pt.e = e;
			pt.pr = -10;
			pt.data = cssp._tween;
			_hasPriority = true;
			return pt;
		}});

		p = "bezier,throwProps,physicsProps,physics2D".split(",");
		i = p.length;
		while (i--) {
			_registerPluginProp(p[i]);
		}








		p = CSSPlugin.prototype;
		p._firstPT = p._lastParsedTransform = p._transform = null;

		//gets called when the tween renders for the first time. This kicks everything off, recording start/end values, etc.
		p._onInitTween = function(target, vars, tween) {
			if (!target.nodeType) { //css is only for dom elements
				return false;
			}
			this._target = target;
			this._tween = tween;
			this._vars = vars;
			_autoRound = vars.autoRound;
			_hasPriority = false;
			_suffixMap = vars.suffixMap || CSSPlugin.suffixMap;
			_cs = _getComputedStyle(target, "");
			_overwriteProps = this._overwriteProps;
			var style = target.style,
				v, pt, pt2, first, last, next, zIndex, tpt, threeD;
			if (_reqSafariFix) if (style.zIndex === "") {
				v = _getStyle(target, "zIndex", _cs);
				if (v === "auto" || v === "") {
					//corrects a bug in [non-Android] Safari that prevents it from repainting elements in their new positions if they don't have a zIndex set. We also can't just apply this inside _parseTransform() because anything that's moved in any way (like using "left" or "top" instead of transforms like "x" and "y") can be affected, so it is best to ensure that anything that's tweening has a z-index. Setting "WebkitPerspective" to a non-zero value worked too except that on iOS Safari things would flicker randomly. Plus zIndex is less memory-intensive.
					this._addLazySet(style, "zIndex", 0);
				}
			}

			if (typeof(vars) === "string") {
				first = style.cssText;
				v = _getAllStyles(target, _cs);
				style.cssText = first + ";" + vars;
				v = _cssDif(target, v, _getAllStyles(target)).difs;
				if (!_supportsOpacity && _opacityValExp.test(vars)) {
					v.opacity = parseFloat( RegExp.$1 );
				}
				vars = v;
				style.cssText = first;
			}
			this._firstPT = pt = this.parse(target, vars, null);

			if (this._transformType) {
				threeD = (this._transformType === 3);
				if (!_transformProp) {
					style.zoom = 1; //helps correct an IE issue.
				} else if (_isSafari) {
					_reqSafariFix = true;
					//if zIndex isn't set, iOS Safari doesn't repaint things correctly sometimes (seemingly at random).
					if (style.zIndex === "") {
						zIndex = _getStyle(target, "zIndex", _cs);
						if (zIndex === "auto" || zIndex === "") {
							this._addLazySet(style, "zIndex", 0);
						}
					}
					//Setting WebkitBackfaceVisibility corrects 3 bugs:
					// 1) [non-Android] Safari skips rendering changes to "top" and "left" that are made on the same frame/render as a transform update.
					// 2) iOS Safari sometimes neglects to repaint elements in their new positions. Setting "WebkitPerspective" to a non-zero value worked too except that on iOS Safari things would flicker randomly.
					// 3) Safari sometimes displayed odd artifacts when tweening the transform (or WebkitTransform) property, like ghosts of the edges of the element remained. Definitely a browser bug.
					//Note: we allow the user to override the auto-setting by defining WebkitBackfaceVisibility in the vars of the tween.
					if (_isSafariLT6) {
						this._addLazySet(style, "WebkitBackfaceVisibility", this._vars.WebkitBackfaceVisibility || (threeD ? "visible" : "hidden"));
					}
				}
				pt2 = pt;
				while (pt2 && pt2._next) {
					pt2 = pt2._next;
				}
				tpt = new CSSPropTween(target, "transform", 0, 0, null, 2);
				this._linkCSSP(tpt, null, pt2);
				tpt.setRatio = (threeD && _supports3D) ? _set3DTransformRatio : _transformProp ? _set2DTransformRatio : _setIETransformRatio;
				tpt.data = this._transform || _getTransform(target, _cs, true);
				_overwriteProps.pop(); //we don't want to force the overwrite of all "transform" tweens of the target - we only care about individual transform properties like scaleX, rotation, etc. The CSSPropTween constructor automatically adds the property to _overwriteProps which is why we need to pop() here.
			}

			if (_hasPriority) {
				//reorders the linked list in order of pr (priority)
				while (pt) {
					next = pt._next;
					pt2 = first;
					while (pt2 && pt2.pr > pt.pr) {
						pt2 = pt2._next;
					}
					if ((pt._prev = pt2 ? pt2._prev : last)) {
						pt._prev._next = pt;
					} else {
						first = pt;
					}
					if ((pt._next = pt2)) {
						pt2._prev = pt;
					} else {
						last = pt;
					}
					pt = next;
				}
				this._firstPT = first;
			}
			return true;
		};


		p.parse = function(target, vars, pt, plugin) {
			var style = target.style,
				p, sp, bn, en, bs, es, bsfx, esfx, isStr, rel;
			for (p in vars) {
				es = vars[p]; //ending value string
				sp = _specialProps[p]; //SpecialProp lookup.
				if (sp) {
					pt = sp.parse(target, es, p, this, pt, plugin, vars);

				} else {
					bs = _getStyle(target, p, _cs) + "";
					isStr = (typeof(es) === "string");
					if (p === "color" || p === "fill" || p === "stroke" || p.indexOf("Color") !== -1 || (isStr && _rgbhslExp.test(es))) { //Opera uses background: to define color sometimes in addition to backgroundColor:
						if (!isStr) {
							es = _parseColor(es);
							es = ((es.length > 3) ? "rgba(" : "rgb(") + es.join(",") + ")";
						}
						pt = _parseComplex(style, p, bs, es, true, "transparent", pt, 0, plugin);

					} else if (isStr && (es.indexOf(" ") !== -1 || es.indexOf(",") !== -1)) {
						pt = _parseComplex(style, p, bs, es, true, null, pt, 0, plugin);

					} else {
						bn = parseFloat(bs);
						bsfx = (bn || bn === 0) ? bs.substr((bn + "").length) : ""; //remember, bs could be non-numeric like "normal" for fontWeight, so we should default to a blank suffix in that case.

						if (bs === "" || bs === "auto") {
							if (p === "width" || p === "height") {
								bn = _getDimension(target, p, _cs);
								bsfx = "px";
							} else if (p === "left" || p === "top") {
								bn = _calculateOffset(target, p, _cs);
								bsfx = "px";
							} else {
								bn = (p !== "opacity") ? 0 : 1;
								bsfx = "";
							}
						}

						rel = (isStr && es.charAt(1) === "=");
						if (rel) {
							en = parseInt(es.charAt(0) + "1", 10);
							es = es.substr(2);
							en *= parseFloat(es);
							esfx = es.replace(_suffixExp, "");
						} else {
							en = parseFloat(es);
							esfx = isStr ? es.substr((en + "").length) || "" : "";
						}

						if (esfx === "") {
							esfx = (p in _suffixMap) ? _suffixMap[p] : bsfx; //populate the end suffix, prioritizing the map, then if none is found, use the beginning suffix.
						}

						es = (en || en === 0) ? (rel ? en + bn : en) + esfx : vars[p]; //ensures that any += or -= prefixes are taken care of. Record the end value before normalizing the suffix because we always want to end the tween on exactly what they intended even if it doesn't match the beginning value's suffix.

						//if the beginning/ending suffixes don't match, normalize them...
						if (bsfx !== esfx) if (esfx !== "") if (en || en === 0) if (bn) { //note: if the beginning value (bn) is 0, we don't need to convert units!
							bn = _convertToPixels(target, p, bn, bsfx);
							if (esfx === "%") {
								bn /= _convertToPixels(target, p, 100, "%") / 100;
								if (vars.strictUnits !== true) { //some browsers report only "px" values instead of allowing "%" with getComputedStyle(), so we assume that if we're tweening to a %, we should start there too unless strictUnits:true is defined. This approach is particularly useful for responsive designs that use from() tweens.
									bs = bn + "%";
								}

							} else if (esfx === "em") {
								bn /= _convertToPixels(target, p, 1, "em");

							//otherwise convert to pixels.
							} else if (esfx !== "px") {
								en = _convertToPixels(target, p, en, esfx);
								esfx = "px"; //we don't use bsfx after this, so we don't need to set it to px too.
							}
							if (rel) if (en || en === 0) {
								es = (en + bn) + esfx; //the changes we made affect relative calculations, so adjust the end value here.
							}
						}

						if (rel) {
							en += bn;
						}

						if ((bn || bn === 0) && (en || en === 0)) { //faster than isNaN(). Also, previously we required en !== bn but that doesn't really gain much performance and it prevents _parseToProxy() from working properly if beginning and ending values match but need to get tweened by an external plugin anyway. For example, a bezier tween where the target starts at left:0 and has these points: [{left:50},{left:0}] wouldn't work properly because when parsing the last point, it'd match the first (current) one and a non-tweening CSSPropTween would be recorded when we actually need a normal tween (type:0) so that things get updated during the tween properly.
							pt = new CSSPropTween(style, p, bn, en - bn, pt, 0, p, (_autoRound !== false && (esfx === "px" || p === "zIndex")), 0, bs, es);
							pt.xs0 = esfx;
							//DEBUG: _log("tween "+p+" from "+pt.b+" ("+bn+esfx+") to "+pt.e+" with suffix: "+pt.xs0);
						} else if (style[p] === undefined || !es && (es + "" === "NaN" || es == null)) {
							_log("invalid " + p + " tween value: " + vars[p]);
						} else {
							pt = new CSSPropTween(style, p, en || bn || 0, 0, pt, -1, p, false, 0, bs, es);
							pt.xs0 = (es === "none" && (p === "display" || p.indexOf("Style") !== -1)) ? bs : es; //intermediate value should typically be set immediately (end value) except for "display" or things like borderTopStyle, borderBottomStyle, etc. which should use the beginning value during the tween.
							//DEBUG: _log("non-tweening value "+p+": "+pt.xs0);
						}
					}
				}
				if (plugin) if (pt && !pt.plugin) {
					pt.plugin = plugin;
				}
			}
			return pt;
		};


		//gets called every time the tween updates, passing the new ratio (typically a value between 0 and 1, but not always (for example, if an Elastic.easeOut is used, the value can jump above 1 mid-tween). It will always start and 0 and end at 1.
		p.setRatio = function(v) {
			var pt = this._firstPT,
				min = 0.000001,
				val, str, i;
			//at the end of the tween, we set the values to exactly what we received in order to make sure non-tweening values (like "position" or "float" or whatever) are set and so that if the beginning/ending suffixes (units) didn't match and we normalized to px, the value that the user passed in is used here. We check to see if the tween is at its beginning in case it's a from() tween in which case the ratio will actually go from 1 to 0 over the course of the tween (backwards).
			if (v === 1 && (this._tween._time === this._tween._duration || this._tween._time === 0)) {
				while (pt) {
					if (pt.type !== 2) {
						pt.t[pt.p] = pt.e;
					} else {
						pt.setRatio(v);
					}
					pt = pt._next;
				}

			} else if (v || !(this._tween._time === this._tween._duration || this._tween._time === 0) || this._tween._rawPrevTime === -0.000001) {
				while (pt) {
					val = pt.c * v + pt.s;
					if (pt.r) {
						val = Math.round(val);
					} else if (val < min) if (val > -min) {
						val = 0;
					}
					if (!pt.type) {
						pt.t[pt.p] = val + pt.xs0;
					} else if (pt.type === 1) { //complex value (one that typically has multiple numbers inside a string, like "rect(5px,10px,20px,25px)"
						i = pt.l;
						if (i === 2) {
							pt.t[pt.p] = pt.xs0 + val + pt.xs1 + pt.xn1 + pt.xs2;
						} else if (i === 3) {
							pt.t[pt.p] = pt.xs0 + val + pt.xs1 + pt.xn1 + pt.xs2 + pt.xn2 + pt.xs3;
						} else if (i === 4) {
							pt.t[pt.p] = pt.xs0 + val + pt.xs1 + pt.xn1 + pt.xs2 + pt.xn2 + pt.xs3 + pt.xn3 + pt.xs4;
						} else if (i === 5) {
							pt.t[pt.p] = pt.xs0 + val + pt.xs1 + pt.xn1 + pt.xs2 + pt.xn2 + pt.xs3 + pt.xn3 + pt.xs4 + pt.xn4 + pt.xs5;
						} else {
							str = pt.xs0 + val + pt.xs1;
							for (i = 1; i < pt.l; i++) {
								str += pt["xn"+i] + pt["xs"+(i+1)];
							}
							pt.t[pt.p] = str;
						}

					} else if (pt.type === -1) { //non-tweening value
						pt.t[pt.p] = pt.xs0;

					} else if (pt.setRatio) { //custom setRatio() for things like SpecialProps, external plugins, etc.
						pt.setRatio(v);
					}
					pt = pt._next;
				}

			//if the tween is reversed all the way back to the beginning, we need to restore the original values which may have different units (like % instead of px or em or whatever).
			} else {
				while (pt) {
					if (pt.type !== 2) {
						pt.t[pt.p] = pt.b;
					} else {
						pt.setRatio(v);
					}
					pt = pt._next;
				}
			}
		};

		/**
		 * @private
		 * Forces rendering of the target's transforms (rotation, scale, etc.) whenever the CSSPlugin's setRatio() is called.
		 * Basically, this tells the CSSPlugin to create a CSSPropTween (type 2) after instantiation that runs last in the linked
		 * list and calls the appropriate (3D or 2D) rendering function. We separate this into its own method so that we can call
		 * it from other plugins like BezierPlugin if, for example, it needs to apply an autoRotation and this CSSPlugin
		 * doesn't have any transform-related properties of its own. You can call this method as many times as you
		 * want and it won't create duplicate CSSPropTweens.
		 *
		 * @param {boolean} threeD if true, it should apply 3D tweens (otherwise, just 2D ones are fine and typically faster)
		 */
		p._enableTransforms = function(threeD) {
			this._transform = this._transform || _getTransform(this._target, _cs, true); //ensures that the element has a _gsTransform property with the appropriate values.
			this._transformType = (!(this._transform.svg && _useSVGTransformAttr) && (threeD || this._transformType === 3)) ? 3 : 2;
		};

		var lazySet = function(v) {
			this.t[this.p] = this.e;
			this.data._linkCSSP(this, this._next, null, true); //we purposefully keep this._next even though it'd make sense to null it, but this is a performance optimization, as this happens during the while (pt) {} loop in setRatio() at the bottom of which it sets pt = pt._next, so if we null it, the linked list will be broken in that loop.
		};
		/** @private Gives us a way to set a value on the first render (and only the first render). **/
		p._addLazySet = function(t, p, v) {
			var pt = this._firstPT = new CSSPropTween(t, p, 0, 0, this._firstPT, 2);
			pt.e = v;
			pt.setRatio = lazySet;
			pt.data = this;
		};

		/** @private **/
		p._linkCSSP = function(pt, next, prev, remove) {
			if (pt) {
				if (next) {
					next._prev = pt;
				}
				if (pt._next) {
					pt._next._prev = pt._prev;
				}
				if (pt._prev) {
					pt._prev._next = pt._next;
				} else if (this._firstPT === pt) {
					this._firstPT = pt._next;
					remove = true; //just to prevent resetting this._firstPT 5 lines down in case pt._next is null. (optimized for speed)
				}
				if (prev) {
					prev._next = pt;
				} else if (!remove && this._firstPT === null) {
					this._firstPT = pt;
				}
				pt._next = next;
				pt._prev = prev;
			}
			return pt;
		};

		//we need to make sure that if alpha or autoAlpha is killed, opacity is too. And autoAlpha affects the "visibility" property.
		p._kill = function(lookup) {
			var copy = lookup,
				pt, p, xfirst;
			if (lookup.autoAlpha || lookup.alpha) {
				copy = {};
				for (p in lookup) { //copy the lookup so that we're not changing the original which may be passed elsewhere.
					copy[p] = lookup[p];
				}
				copy.opacity = 1;
				if (copy.autoAlpha) {
					copy.visibility = 1;
				}
			}
			if (lookup.className && (pt = this._classNamePT)) { //for className tweens, we need to kill any associated CSSPropTweens too; a linked list starts at the className's "xfirst".
				xfirst = pt.xfirst;
				if (xfirst && xfirst._prev) {
					this._linkCSSP(xfirst._prev, pt._next, xfirst._prev._prev); //break off the prev
				} else if (xfirst === this._firstPT) {
					this._firstPT = pt._next;
				}
				if (pt._next) {
					this._linkCSSP(pt._next, pt._next._next, xfirst._prev);
				}
				this._classNamePT = null;
			}
			return TweenPlugin.prototype._kill.call(this, copy);
		};



		//used by cascadeTo() for gathering all the style properties of each child element into an array for comparison.
		var _getChildStyles = function(e, props, targets) {
				var children, i, child, type;
				if (e.slice) {
					i = e.length;
					while (--i > -1) {
						_getChildStyles(e[i], props, targets);
					}
					return;
				}
				children = e.childNodes;
				i = children.length;
				while (--i > -1) {
					child = children[i];
					type = child.type;
					if (child.style) {
						props.push(_getAllStyles(child));
						if (targets) {
							targets.push(child);
						}
					}
					if ((type === 1 || type === 9 || type === 11) && child.childNodes.length) {
						_getChildStyles(child, props, targets);
					}
				}
			};

		/**
		 * Typically only useful for className tweens that may affect child elements, this method creates a TweenLite
		 * and then compares the style properties of all the target's child elements at the tween's start and end, and
		 * if any are different, it also creates tweens for those and returns an array containing ALL of the resulting
		 * tweens (so that you can easily add() them to a TimelineLite, for example). The reason this functionality is
		 * wrapped into a separate static method of CSSPlugin instead of being integrated into all regular className tweens
		 * is because it creates entirely new tweens that may have completely different targets than the original tween,
		 * so if they were all lumped into the original tween instance, it would be inconsistent with the rest of the API
		 * and it would create other problems. For example:
		 *  - If I create a tween of elementA, that tween instance may suddenly change its target to include 50 other elements (unintuitive if I specifically defined the target I wanted)
		 *  - We can't just create new independent tweens because otherwise, what happens if the original/parent tween is reversed or pause or dropped into a TimelineLite for tight control? You'd expect that tween's behavior to affect all the others.
		 *  - Analyzing every style property of every child before and after the tween is an expensive operation when there are many children, so this behavior shouldn't be imposed on all className tweens by default, especially since it's probably rare that this extra functionality is needed.
		 *
		 * @param {Object} target object to be tweened
		 * @param {number} Duration in seconds (or frames for frames-based tweens)
		 * @param {Object} Object containing the end values, like {className:"newClass", ease:Linear.easeNone}
		 * @return {Array} An array of TweenLite instances
		 */
		CSSPlugin.cascadeTo = function(target, duration, vars) {
			var tween = TweenLite.to(target, duration, vars),
				results = [tween],
				b = [],
				e = [],
				targets = [],
				_reservedProps = TweenLite._internals.reservedProps,
				i, difs, p;
			target = tween._targets || tween.target;
			_getChildStyles(target, b, targets);
			tween.render(duration, true);
			_getChildStyles(target, e);
			tween.render(0, true);
			tween._enabled(true);
			i = targets.length;
			while (--i > -1) {
				difs = _cssDif(targets[i], b[i], e[i]);
				if (difs.firstMPT) {
					difs = difs.difs;
					for (p in vars) {
						if (_reservedProps[p]) {
							difs[p] = vars[p];
						}
					}
					results.push( TweenLite.to(targets[i], duration, difs) );
				}
			}
			return results;
		};

		TweenPlugin.activate([CSSPlugin]);
		return CSSPlugin;

	}, true);

	
	
	
	
	
	
	
	
	
	
/*
 * ----------------------------------------------------------------
 * RoundPropsPlugin
 * ----------------------------------------------------------------
 */
	(function() {

		var RoundPropsPlugin = _gsScope._gsDefine.plugin({
				propName: "roundProps",
				priority: -1,
				API: 2,

				//called when the tween renders for the first time. This is where initial values should be recorded and any setup routines should run.
				init: function(target, value, tween) {
					this._tween = tween;
					return true;
				}

			}),
			p = RoundPropsPlugin.prototype;

		p._onInitAllProps = function() {
			var tween = this._tween,
				rp = (tween.vars.roundProps instanceof Array) ? tween.vars.roundProps : tween.vars.roundProps.split(","),
				i = rp.length,
				lookup = {},
				rpt = tween._propLookup.roundProps,
				prop, pt, next;
			while (--i > -1) {
				lookup[rp[i]] = 1;
			}
			i = rp.length;
			while (--i > -1) {
				prop = rp[i];
				pt = tween._firstPT;
				while (pt) {
					next = pt._next; //record here, because it may get removed
					if (pt.pg) {
						pt.t._roundProps(lookup, true);
					} else if (pt.n === prop) {
						this._add(pt.t, prop, pt.s, pt.c);
						//remove from linked list
						if (next) {
							next._prev = pt._prev;
						}
						if (pt._prev) {
							pt._prev._next = next;
						} else if (tween._firstPT === pt) {
							tween._firstPT = next;
						}
						pt._next = pt._prev = null;
						tween._propLookup[prop] = rpt;
					}
					pt = next;
				}
			}
			return false;
		};

		p._add = function(target, p, s, c) {
			this._addTween(target, p, s, s + c, p, true);
			this._overwriteProps.push(p);
		};

	}());










/*
 * ----------------------------------------------------------------
 * AttrPlugin
 * ----------------------------------------------------------------
 */
	_gsScope._gsDefine.plugin({
		propName: "attr",
		API: 2,
		version: "0.3.3",

		//called when the tween renders for the first time. This is where initial values should be recorded and any setup routines should run.
		init: function(target, value, tween) {
			var p, start, end;
			if (typeof(target.setAttribute) !== "function") {
				return false;
			}
			this._target = target;
			this._proxy = {};
			this._start = {}; // we record start and end values exactly as they are in case they're strings (not numbers) - we need to be able to revert to them cleanly.
			this._end = {};
			for (p in value) {
				this._start[p] = this._proxy[p] = start = target.getAttribute(p);
				end = this._addTween(this._proxy, p, parseFloat(start), value[p], p);
				this._end[p] = end ? end.s + end.c : value[p];
				this._overwriteProps.push(p);
			}
			return true;
		},

		//called each time the values should be updated, and the ratio gets passed as the only parameter (typically it's a value between 0 and 1, but it can exceed those when using an ease like Elastic.easeOut or Back.easeOut, etc.)
		set: function(ratio) {
			this._super.setRatio.call(this, ratio);
			var props = this._overwriteProps,
				i = props.length,
				lookup = (ratio === 1) ? this._end : ratio ? this._proxy : this._start,
				p;
			while (--i > -1) {
				p = props[i];
				this._target.setAttribute(p, lookup[p] + "");
			}
		}

	});










/*
 * ----------------------------------------------------------------
 * DirectionalRotationPlugin
 * ----------------------------------------------------------------
 */
	_gsScope._gsDefine.plugin({
		propName: "directionalRotation",
		version: "0.2.1",
		API: 2,

		//called when the tween renders for the first time. This is where initial values should be recorded and any setup routines should run.
		init: function(target, value, tween) {
			if (typeof(value) !== "object") {
				value = {rotation:value};
			}
			this.finals = {};
			var cap = (value.useRadians === true) ? Math.PI * 2 : 360,
				min = 0.000001,
				p, v, start, end, dif, split;
			for (p in value) {
				if (p !== "useRadians") {
					split = (value[p] + "").split("_");
					v = split[0];
					start = parseFloat( (typeof(target[p]) !== "function") ? target[p] : target[ ((p.indexOf("set") || typeof(target["get" + p.substr(3)]) !== "function") ? p : "get" + p.substr(3)) ]() );
					end = this.finals[p] = (typeof(v) === "string" && v.charAt(1) === "=") ? start + parseInt(v.charAt(0) + "1", 10) * Number(v.substr(2)) : Number(v) || 0;
					dif = end - start;
					if (split.length) {
						v = split.join("_");
						if (v.indexOf("short") !== -1) {
							dif = dif % cap;
							if (dif !== dif % (cap / 2)) {
								dif = (dif < 0) ? dif + cap : dif - cap;
							}
						}
						if (v.indexOf("_cw") !== -1 && dif < 0) {
							dif = ((dif + cap * 9999999999) % cap) - ((dif / cap) | 0) * cap;
						} else if (v.indexOf("ccw") !== -1 && dif > 0) {
							dif = ((dif - cap * 9999999999) % cap) - ((dif / cap) | 0) * cap;
						}
					}
					if (dif > min || dif < -min) {
						this._addTween(target, p, start, start + dif, p);
						this._overwriteProps.push(p);
					}
				}
			}
			return true;
		},

		//called each time the values should be updated, and the ratio gets passed as the only parameter (typically it's a value between 0 and 1, but it can exceed those when using an ease like Elastic.easeOut or Back.easeOut, etc.)
		set: function(ratio) {
			var pt;
			if (ratio !== 1) {
				this._super.setRatio.call(this, ratio);
			} else {
				pt = this._firstPT;
				while (pt) {
					if (pt.f) {
						pt.t[pt.p](this.finals[pt.p]);
					} else {
						pt.t[pt.p] = this.finals[pt.p];
					}
					pt = pt._next;
				}
			}
		}

	})._autoCSS = true;







	
	
	
	
/*
 * ----------------------------------------------------------------
 * EasePack
 * ----------------------------------------------------------------
 */
	_gsScope._gsDefine("easing.Back", ["easing.Ease"], function(Ease) {
		
		var w = (_gsScope.GreenSockGlobals || _gsScope),
			gs = w.com.greensock,
			_2PI = Math.PI * 2,
			_HALF_PI = Math.PI / 2,
			_class = gs._class,
			_create = function(n, f) {
				var C = _class("easing." + n, function(){}, true),
					p = C.prototype = new Ease();
				p.constructor = C;
				p.getRatio = f;
				return C;
			},
			_easeReg = Ease.register || function(){}, //put an empty function in place just as a safety measure in case someone loads an OLD version of TweenLite.js where Ease.register doesn't exist.
			_wrap = function(name, EaseOut, EaseIn, EaseInOut, aliases) {
				var C = _class("easing."+name, {
					easeOut:new EaseOut(),
					easeIn:new EaseIn(),
					easeInOut:new EaseInOut()
				}, true);
				_easeReg(C, name);
				return C;
			},
			EasePoint = function(time, value, next) {
				this.t = time;
				this.v = value;
				if (next) {
					this.next = next;
					next.prev = this;
					this.c = next.v - value;
					this.gap = next.t - time;
				}
			},

			//Back
			_createBack = function(n, f) {
				var C = _class("easing." + n, function(overshoot) {
						this._p1 = (overshoot || overshoot === 0) ? overshoot : 1.70158;
						this._p2 = this._p1 * 1.525;
					}, true),
					p = C.prototype = new Ease();
				p.constructor = C;
				p.getRatio = f;
				p.config = function(overshoot) {
					return new C(overshoot);
				};
				return C;
			},

			Back = _wrap("Back",
				_createBack("BackOut", function(p) {
					return ((p = p - 1) * p * ((this._p1 + 1) * p + this._p1) + 1);
				}),
				_createBack("BackIn", function(p) {
					return p * p * ((this._p1 + 1) * p - this._p1);
				}),
				_createBack("BackInOut", function(p) {
					return ((p *= 2) < 1) ? 0.5 * p * p * ((this._p2 + 1) * p - this._p2) : 0.5 * ((p -= 2) * p * ((this._p2 + 1) * p + this._p2) + 2);
				})
			),


			//SlowMo
			SlowMo = _class("easing.SlowMo", function(linearRatio, power, yoyoMode) {
				power = (power || power === 0) ? power : 0.7;
				if (linearRatio == null) {
					linearRatio = 0.7;
				} else if (linearRatio > 1) {
					linearRatio = 1;
				}
				this._p = (linearRatio !== 1) ? power : 0;
				this._p1 = (1 - linearRatio) / 2;
				this._p2 = linearRatio;
				this._p3 = this._p1 + this._p2;
				this._calcEnd = (yoyoMode === true);
			}, true),
			p = SlowMo.prototype = new Ease(),
			SteppedEase, RoughEase, _createElastic;

		p.constructor = SlowMo;
		p.getRatio = function(p) {
			var r = p + (0.5 - p) * this._p;
			if (p < this._p1) {
				return this._calcEnd ? 1 - ((p = 1 - (p / this._p1)) * p) : r - ((p = 1 - (p / this._p1)) * p * p * p * r);
			} else if (p > this._p3) {
				return this._calcEnd ? 1 - (p = (p - this._p3) / this._p1) * p : r + ((p - r) * (p = (p - this._p3) / this._p1) * p * p * p);
			}
			return this._calcEnd ? 1 : r;
		};
		SlowMo.ease = new SlowMo(0.7, 0.7);

		p.config = SlowMo.config = function(linearRatio, power, yoyoMode) {
			return new SlowMo(linearRatio, power, yoyoMode);
		};


		//SteppedEase
		SteppedEase = _class("easing.SteppedEase", function(steps) {
				steps = steps || 1;
				this._p1 = 1 / steps;
				this._p2 = steps + 1;
			}, true);
		p = SteppedEase.prototype = new Ease();
		p.constructor = SteppedEase;
		p.getRatio = function(p) {
			if (p < 0) {
				p = 0;
			} else if (p >= 1) {
				p = 0.999999999;
			}
			return ((this._p2 * p) >> 0) * this._p1;
		};
		p.config = SteppedEase.config = function(steps) {
			return new SteppedEase(steps);
		};


		//RoughEase
		RoughEase = _class("easing.RoughEase", function(vars) {
			vars = vars || {};
			var taper = vars.taper || "none",
				a = [],
				cnt = 0,
				points = (vars.points || 20) | 0,
				i = points,
				randomize = (vars.randomize !== false),
				clamp = (vars.clamp === true),
				template = (vars.template instanceof Ease) ? vars.template : null,
				strength = (typeof(vars.strength) === "number") ? vars.strength * 0.4 : 0.4,
				x, y, bump, invX, obj, pnt;
			while (--i > -1) {
				x = randomize ? Math.random() : (1 / points) * i;
				y = template ? template.getRatio(x) : x;
				if (taper === "none") {
					bump = strength;
				} else if (taper === "out") {
					invX = 1 - x;
					bump = invX * invX * strength;
				} else if (taper === "in") {
					bump = x * x * strength;
				} else if (x < 0.5) {  //"both" (start)
					invX = x * 2;
					bump = invX * invX * 0.5 * strength;
				} else {				//"both" (end)
					invX = (1 - x) * 2;
					bump = invX * invX * 0.5 * strength;
				}
				if (randomize) {
					y += (Math.random() * bump) - (bump * 0.5);
				} else if (i % 2) {
					y += bump * 0.5;
				} else {
					y -= bump * 0.5;
				}
				if (clamp) {
					if (y > 1) {
						y = 1;
					} else if (y < 0) {
						y = 0;
					}
				}
				a[cnt++] = {x:x, y:y};
			}
			a.sort(function(a, b) {
				return a.x - b.x;
			});

			pnt = new EasePoint(1, 1, null);
			i = points;
			while (--i > -1) {
				obj = a[i];
				pnt = new EasePoint(obj.x, obj.y, pnt);
			}

			this._prev = new EasePoint(0, 0, (pnt.t !== 0) ? pnt : pnt.next);
		}, true);
		p = RoughEase.prototype = new Ease();
		p.constructor = RoughEase;
		p.getRatio = function(p) {
			var pnt = this._prev;
			if (p > pnt.t) {
				while (pnt.next && p >= pnt.t) {
					pnt = pnt.next;
				}
				pnt = pnt.prev;
			} else {
				while (pnt.prev && p <= pnt.t) {
					pnt = pnt.prev;
				}
			}
			this._prev = pnt;
			return (pnt.v + ((p - pnt.t) / pnt.gap) * pnt.c);
		};
		p.config = function(vars) {
			return new RoughEase(vars);
		};
		RoughEase.ease = new RoughEase();


		//Bounce
		_wrap("Bounce",
			_create("BounceOut", function(p) {
				if (p < 1 / 2.75) {
					return 7.5625 * p * p;
				} else if (p < 2 / 2.75) {
					return 7.5625 * (p -= 1.5 / 2.75) * p + 0.75;
				} else if (p < 2.5 / 2.75) {
					return 7.5625 * (p -= 2.25 / 2.75) * p + 0.9375;
				}
				return 7.5625 * (p -= 2.625 / 2.75) * p + 0.984375;
			}),
			_create("BounceIn", function(p) {
				if ((p = 1 - p) < 1 / 2.75) {
					return 1 - (7.5625 * p * p);
				} else if (p < 2 / 2.75) {
					return 1 - (7.5625 * (p -= 1.5 / 2.75) * p + 0.75);
				} else if (p < 2.5 / 2.75) {
					return 1 - (7.5625 * (p -= 2.25 / 2.75) * p + 0.9375);
				}
				return 1 - (7.5625 * (p -= 2.625 / 2.75) * p + 0.984375);
			}),
			_create("BounceInOut", function(p) {
				var invert = (p < 0.5);
				if (invert) {
					p = 1 - (p * 2);
				} else {
					p = (p * 2) - 1;
				}
				if (p < 1 / 2.75) {
					p = 7.5625 * p * p;
				} else if (p < 2 / 2.75) {
					p = 7.5625 * (p -= 1.5 / 2.75) * p + 0.75;
				} else if (p < 2.5 / 2.75) {
					p = 7.5625 * (p -= 2.25 / 2.75) * p + 0.9375;
				} else {
					p = 7.5625 * (p -= 2.625 / 2.75) * p + 0.984375;
				}
				return invert ? (1 - p) * 0.5 : p * 0.5 + 0.5;
			})
		);


		//CIRC
		_wrap("Circ",
			_create("CircOut", function(p) {
				return Math.sqrt(1 - (p = p - 1) * p);
			}),
			_create("CircIn", function(p) {
				return -(Math.sqrt(1 - (p * p)) - 1);
			}),
			_create("CircInOut", function(p) {
				return ((p*=2) < 1) ? -0.5 * (Math.sqrt(1 - p * p) - 1) : 0.5 * (Math.sqrt(1 - (p -= 2) * p) + 1);
			})
		);


		//Elastic
		_createElastic = function(n, f, def) {
			var C = _class("easing." + n, function(amplitude, period) {
					this._p1 = amplitude || 1;
					this._p2 = period || def;
					this._p3 = this._p2 / _2PI * (Math.asin(1 / this._p1) || 0);
				}, true),
				p = C.prototype = new Ease();
			p.constructor = C;
			p.getRatio = f;
			p.config = function(amplitude, period) {
				return new C(amplitude, period);
			};
			return C;
		};
		_wrap("Elastic",
			_createElastic("ElasticOut", function(p) {
				return this._p1 * Math.pow(2, -10 * p) * Math.sin( (p - this._p3) * _2PI / this._p2 ) + 1;
			}, 0.3),
			_createElastic("ElasticIn", function(p) {
				return -(this._p1 * Math.pow(2, 10 * (p -= 1)) * Math.sin( (p - this._p3) * _2PI / this._p2 ));
			}, 0.3),
			_createElastic("ElasticInOut", function(p) {
				return ((p *= 2) < 1) ? -0.5 * (this._p1 * Math.pow(2, 10 * (p -= 1)) * Math.sin( (p - this._p3) * _2PI / this._p2)) : this._p1 * Math.pow(2, -10 *(p -= 1)) * Math.sin( (p - this._p3) * _2PI / this._p2 ) *0.5 + 1;
			}, 0.45)
		);


		//Expo
		_wrap("Expo",
			_create("ExpoOut", function(p) {
				return 1 - Math.pow(2, -10 * p);
			}),
			_create("ExpoIn", function(p) {
				return Math.pow(2, 10 * (p - 1)) - 0.001;
			}),
			_create("ExpoInOut", function(p) {
				return ((p *= 2) < 1) ? 0.5 * Math.pow(2, 10 * (p - 1)) : 0.5 * (2 - Math.pow(2, -10 * (p - 1)));
			})
		);


		//Sine
		_wrap("Sine",
			_create("SineOut", function(p) {
				return Math.sin(p * _HALF_PI);
			}),
			_create("SineIn", function(p) {
				return -Math.cos(p * _HALF_PI) + 1;
			}),
			_create("SineInOut", function(p) {
				return -0.5 * (Math.cos(Math.PI * p) - 1);
			})
		);

		_class("easing.EaseLookup", {
				find:function(s) {
					return Ease.map[s];
				}
			}, true);

		//register the non-standard eases
		_easeReg(w.SlowMo, "SlowMo", "ease,");
		_easeReg(RoughEase, "RoughEase", "ease,");
		_easeReg(SteppedEase, "SteppedEase", "ease,");

		return Back;
		
	}, true);


});

if (_gsScope._gsDefine) { _gsScope._gsQueue.pop()(); } //necessary in case TweenLite was already loaded separately.











/*
 * ----------------------------------------------------------------
 * Base classes like TweenLite, SimpleTimeline, Ease, Ticker, etc.
 * ----------------------------------------------------------------
 */
(function(window, moduleName) {

		"use strict";
		var _globals = window.GreenSockGlobals = window.GreenSockGlobals || window;
		if (_globals.TweenLite) {
			return; //in case the core set of classes is already loaded, don't instantiate twice.
		}
		var _namespace = function(ns) {
				var a = ns.split("."),
					p = _globals, i;
				for (i = 0; i < a.length; i++) {
					p[a[i]] = p = p[a[i]] || {};
				}
				return p;
			},
			gs = _namespace("com.greensock"),
			_tinyNum = 0.0000000001,
			_slice = function(a) { //don't use Array.prototype.slice.call(target, 0) because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
				var b = [],
					l = a.length,
					i;
				for (i = 0; i !== l; b.push(a[i++]));
				return b;
			},
			_emptyFunc = function() {},
			_isArray = (function() { //works around issues in iframe environments where the Array global isn't shared, thus if the object originates in a different window/iframe, "(obj instanceof Array)" will evaluate false. We added some speed optimizations to avoid Object.prototype.toString.call() unless it's absolutely necessary because it's VERY slow (like 20x slower)
				var toString = Object.prototype.toString,
					array = toString.call([]);
				return function(obj) {
					return obj != null && (obj instanceof Array || (typeof(obj) === "object" && !!obj.push && toString.call(obj) === array));
				};
			}()),
			a, i, p, _ticker, _tickerActive,
			_defLookup = {},

			/**
			 * @constructor
			 * Defines a GreenSock class, optionally with an array of dependencies that must be instantiated first and passed into the definition.
			 * This allows users to load GreenSock JS files in any order even if they have interdependencies (like CSSPlugin extends TweenPlugin which is
			 * inside TweenLite.js, but if CSSPlugin is loaded first, it should wait to run its code until TweenLite.js loads and instantiates TweenPlugin
			 * and then pass TweenPlugin to CSSPlugin's definition). This is all done automatically and internally.
			 *
			 * Every definition will be added to a "com.greensock" global object (typically window, but if a window.GreenSockGlobals object is found,
			 * it will go there as of v1.7). For example, TweenLite will be found at window.com.greensock.TweenLite and since it's a global class that should be available anywhere,
			 * it is ALSO referenced at window.TweenLite. However some classes aren't considered global, like the base com.greensock.core.Animation class, so
			 * those will only be at the package like window.com.greensock.core.Animation. Again, if you define a GreenSockGlobals object on the window, everything
			 * gets tucked neatly inside there instead of on the window directly. This allows you to do advanced things like load multiple versions of GreenSock
			 * files and put them into distinct objects (imagine a banner ad uses a newer version but the main site uses an older one). In that case, you could
			 * sandbox the banner one like:
			 *
			 * <script>
			 *     var gs = window.GreenSockGlobals = {}; //the newer version we're about to load could now be referenced in a "gs" object, like gs.TweenLite.to(...). Use whatever alias you want as long as it's unique, "gs" or "banner" or whatever.
			 * </script>
			 * <script src="js/greensock/v1.7/TweenMax.js"></script>
			 * <script>
			 *     window.GreenSockGlobals = window._gsQueue = window._gsDefine = null; //reset it back to null (along with the special _gsQueue variable) so that the next load of TweenMax affects the window and we can reference things directly like TweenLite.to(...)
			 * </script>
			 * <script src="js/greensock/v1.6/TweenMax.js"></script>
			 * <script>
			 *     gs.TweenLite.to(...); //would use v1.7
			 *     TweenLite.to(...); //would use v1.6
			 * </script>
			 *
			 * @param {!string} ns The namespace of the class definition, leaving off "com.greensock." as that's assumed. For example, "TweenLite" or "plugins.CSSPlugin" or "easing.Back".
			 * @param {!Array.<string>} dependencies An array of dependencies (described as their namespaces minus "com.greensock." prefix). For example ["TweenLite","plugins.TweenPlugin","core.Animation"]
			 * @param {!function():Object} func The function that should be called and passed the resolved dependencies which will return the actual class for this definition.
			 * @param {boolean=} global If true, the class will be added to the global scope (typically window unless you define a window.GreenSockGlobals object)
			 */
			Definition = function(ns, dependencies, func, global) {
				this.sc = (_defLookup[ns]) ? _defLookup[ns].sc : []; //subclasses
				_defLookup[ns] = this;
				this.gsClass = null;
				this.func = func;
				var _classes = [];
				this.check = function(init) {
					var i = dependencies.length,
						missing = i,
						cur, a, n, cl;
					while (--i > -1) {
						if ((cur = _defLookup[dependencies[i]] || new Definition(dependencies[i], [])).gsClass) {
							_classes[i] = cur.gsClass;
							missing--;
						} else if (init) {
							cur.sc.push(this);
						}
					}
					if (missing === 0 && func) {
						a = ("com.greensock." + ns).split(".");
						n = a.pop();
						cl = _namespace(a.join("."))[n] = this.gsClass = func.apply(func, _classes);

						//exports to multiple environments
						if (global) {
							_globals[n] = cl; //provides a way to avoid global namespace pollution. By default, the main classes like TweenLite, Power1, Strong, etc. are added to window unless a GreenSockGlobals is defined. So if you want to have things added to a custom object instead, just do something like window.GreenSockGlobals = {} before loading any GreenSock files. You can even set up an alias like window.GreenSockGlobals = windows.gs = {} so that you can access everything like gs.TweenLite. Also remember that ALL classes are added to the window.com.greensock object (in their respective packages, like com.greensock.easing.Power1, com.greensock.TweenLite, etc.)
							if (typeof(define) === "function" && define.amd){ //AMD
								define((window.GreenSockAMDPath ? window.GreenSockAMDPath + "/" : "") + ns.split(".").pop(), [], function() { return cl; });
							} else if (ns === moduleName && typeof(module) !== "undefined" && module.exports){ //node
								module.exports = cl;
							}
						}
						for (i = 0; i < this.sc.length; i++) {
							this.sc[i].check();
						}
					}
				};
				this.check(true);
			},

			//used to create Definition instances (which basically registers a class that has dependencies).
			_gsDefine = window._gsDefine = function(ns, dependencies, func, global) {
				return new Definition(ns, dependencies, func, global);
			},

			//a quick way to create a class that doesn't have any dependencies. Returns the class, but first registers it in the GreenSock namespace so that other classes can grab it (other classes might be dependent on the class).
			_class = gs._class = function(ns, func, global) {
				func = func || function() {};
				_gsDefine(ns, [], function(){ return func; }, global);
				return func;
			};

		_gsDefine.globals = _globals;



/*
 * ----------------------------------------------------------------
 * Ease
 * ----------------------------------------------------------------
 */
		var _baseParams = [0, 0, 1, 1],
			_blankArray = [],
			Ease = _class("easing.Ease", function(func, extraParams, type, power) {
				this._func = func;
				this._type = type || 0;
				this._power = power || 0;
				this._params = extraParams ? _baseParams.concat(extraParams) : _baseParams;
			}, true),
			_easeMap = Ease.map = {},
			_easeReg = Ease.register = function(ease, names, types, create) {
				var na = names.split(","),
					i = na.length,
					ta = (types || "easeIn,easeOut,easeInOut").split(","),
					e, name, j, type;
				while (--i > -1) {
					name = na[i];
					e = create ? _class("easing."+name, null, true) : gs.easing[name] || {};
					j = ta.length;
					while (--j > -1) {
						type = ta[j];
						_easeMap[name + "." + type] = _easeMap[type + name] = e[type] = ease.getRatio ? ease : ease[type] || new ease();
					}
				}
			};

		p = Ease.prototype;
		p._calcEnd = false;
		p.getRatio = function(p) {
			if (this._func) {
				this._params[0] = p;
				return this._func.apply(null, this._params);
			}
			var t = this._type,
				pw = this._power,
				r = (t === 1) ? 1 - p : (t === 2) ? p : (p < 0.5) ? p * 2 : (1 - p) * 2;
			if (pw === 1) {
				r *= r;
			} else if (pw === 2) {
				r *= r * r;
			} else if (pw === 3) {
				r *= r * r * r;
			} else if (pw === 4) {
				r *= r * r * r * r;
			}
			return (t === 1) ? 1 - r : (t === 2) ? r : (p < 0.5) ? r / 2 : 1 - (r / 2);
		};

		//create all the standard eases like Linear, Quad, Cubic, Quart, Quint, Strong, Power0, Power1, Power2, Power3, and Power4 (each with easeIn, easeOut, and easeInOut)
		a = ["Linear","Quad","Cubic","Quart","Quint,Strong"];
		i = a.length;
		while (--i > -1) {
			p = a[i]+",Power"+i;
			_easeReg(new Ease(null,null,1,i), p, "easeOut", true);
			_easeReg(new Ease(null,null,2,i), p, "easeIn" + ((i === 0) ? ",easeNone" : ""));
			_easeReg(new Ease(null,null,3,i), p, "easeInOut");
		}
		_easeMap.linear = gs.easing.Linear.easeIn;
		_easeMap.swing = gs.easing.Quad.easeInOut; //for jQuery folks


/*
 * ----------------------------------------------------------------
 * EventDispatcher
 * ----------------------------------------------------------------
 */
		var EventDispatcher = _class("events.EventDispatcher", function(target) {
			this._listeners = {};
			this._eventTarget = target || this;
		});
		p = EventDispatcher.prototype;

		p.addEventListener = function(type, callback, scope, useParam, priority) {
			priority = priority || 0;
			var list = this._listeners[type],
				index = 0,
				listener, i;
			if (list == null) {
				this._listeners[type] = list = [];
			}
			i = list.length;
			while (--i > -1) {
				listener = list[i];
				if (listener.c === callback && listener.s === scope) {
					list.splice(i, 1);
				} else if (index === 0 && listener.pr < priority) {
					index = i + 1;
				}
			}
			list.splice(index, 0, {c:callback, s:scope, up:useParam, pr:priority});
			if (this === _ticker && !_tickerActive) {
				_ticker.wake();
			}
		};

		p.removeEventListener = function(type, callback) {
			var list = this._listeners[type], i;
			if (list) {
				i = list.length;
				while (--i > -1) {
					if (list[i].c === callback) {
						list.splice(i, 1);
						return;
					}
				}
			}
		};

		p.dispatchEvent = function(type) {
			var list = this._listeners[type],
				i, t, listener;
			if (list) {
				i = list.length;
				t = this._eventTarget;
				while (--i > -1) {
					listener = list[i];
					if (listener) {
						if (listener.up) {
							listener.c.call(listener.s || t, {type:type, target:t});
						} else {
							listener.c.call(listener.s || t);
						}
					}
				}
			}
		};


/*
 * ----------------------------------------------------------------
 * Ticker
 * ----------------------------------------------------------------
 */
 		var _reqAnimFrame = window.requestAnimationFrame,
			_cancelAnimFrame = window.cancelAnimationFrame,
			_getTime = Date.now || function() {return new Date().getTime();},
			_lastUpdate = _getTime();

		//now try to determine the requestAnimationFrame and cancelAnimationFrame functions and if none are found, we'll use a setTimeout()/clearTimeout() polyfill.
		a = ["ms","moz","webkit","o"];
		i = a.length;
		while (--i > -1 && !_reqAnimFrame) {
			_reqAnimFrame = window[a[i] + "RequestAnimationFrame"];
			_cancelAnimFrame = window[a[i] + "CancelAnimationFrame"] || window[a[i] + "CancelRequestAnimationFrame"];
		}

		_class("Ticker", function(fps, useRAF) {
			var _self = this,
				_startTime = _getTime(),
				_useRAF = (useRAF !== false && _reqAnimFrame),
				_lagThreshold = 500,
				_adjustedLag = 33,
				_tickWord = "tick", //helps reduce gc burden
				_fps, _req, _id, _gap, _nextTime,
				_tick = function(manual) {
					var elapsed = _getTime() - _lastUpdate,
						overlap, dispatch;
					if (elapsed > _lagThreshold) {
						_startTime += elapsed - _adjustedLag;
					}
					_lastUpdate += elapsed;
					_self.time = (_lastUpdate - _startTime) / 1000;
					overlap = _self.time - _nextTime;
					if (!_fps || overlap > 0 || manual === true) {
						_self.frame++;
						_nextTime += overlap + (overlap >= _gap ? 0.004 : _gap - overlap);
						dispatch = true;
					}
					if (manual !== true) { //make sure the request is made before we dispatch the "tick" event so that timing is maintained. Otherwise, if processing the "tick" requires a bunch of time (like 15ms) and we're using a setTimeout() that's based on 16.7ms, it'd technically take 31.7ms between frames otherwise.
						_id = _req(_tick);
					}
					if (dispatch) {
						_self.dispatchEvent(_tickWord);
					}
				};

			EventDispatcher.call(_self);
			_self.time = _self.frame = 0;
			_self.tick = function() {
				_tick(true);
			};

			_self.lagSmoothing = function(threshold, adjustedLag) {
				_lagThreshold = threshold || (1 / _tinyNum); //zero should be interpreted as basically unlimited
				_adjustedLag = Math.min(adjustedLag, _lagThreshold, 0);
			};

			_self.sleep = function() {
				if (_id == null) {
					return;
				}
				if (!_useRAF || !_cancelAnimFrame) {
					clearTimeout(_id);
				} else {
					_cancelAnimFrame(_id);
				}
				_req = _emptyFunc;
				_id = null;
				if (_self === _ticker) {
					_tickerActive = false;
				}
			};

			_self.wake = function() {
				if (_id !== null) {
					_self.sleep();
				} else if (_self.frame > 10) { //don't trigger lagSmoothing if we're just waking up, and make sure that at least 10 frames have elapsed because of the iOS bug that we work around below with the 1.5-second setTimout().
					_lastUpdate = _getTime() - _lagThreshold + 5;
				}
				_req = (_fps === 0) ? _emptyFunc : (!_useRAF || !_reqAnimFrame) ? function(f) { return setTimeout(f, ((_nextTime - _self.time) * 1000 + 1) | 0); } : _reqAnimFrame;
				if (_self === _ticker) {
					_tickerActive = true;
				}
				_tick(2);
			};

			_self.fps = function(value) {
				if (!arguments.length) {
					return _fps;
				}
				_fps = value;
				_gap = 1 / (_fps || 60);
				_nextTime = this.time + _gap;
				_self.wake();
			};

			_self.useRAF = function(value) {
				if (!arguments.length) {
					return _useRAF;
				}
				_self.sleep();
				_useRAF = value;
				_self.fps(_fps);
			};
			_self.fps(fps);

			//a bug in iOS 6 Safari occasionally prevents the requestAnimationFrame from working initially, so we use a 1.5-second timeout that automatically falls back to setTimeout() if it senses this condition.
			setTimeout(function() {
				if (_useRAF && (!_id || _self.frame < 5)) {
					_self.useRAF(false);
				}
			}, 1500);
		});

		p = gs.Ticker.prototype = new gs.events.EventDispatcher();
		p.constructor = gs.Ticker;


/*
 * ----------------------------------------------------------------
 * Animation
 * ----------------------------------------------------------------
 */
		var Animation = _class("core.Animation", function(duration, vars) {
				this.vars = vars = vars || {};
				this._duration = this._totalDuration = duration || 0;
				this._delay = Number(vars.delay) || 0;
				this._timeScale = 1;
				this._active = (vars.immediateRender === true);
				this.data = vars.data;
				this._reversed = (vars.reversed === true);

				if (!_rootTimeline) {
					return;
				}
				if (!_tickerActive) { //some browsers (like iOS 6 Safari) shut down JavaScript execution when the tab is disabled and they [occasionally] neglect to start up requestAnimationFrame again when returning - this code ensures that the engine starts up again properly.
					_ticker.wake();
				}

				var tl = this.vars.useFrames ? _rootFramesTimeline : _rootTimeline;
				tl.add(this, tl._time);

				if (this.vars.paused) {
					this.paused(true);
				}
			});

		_ticker = Animation.ticker = new gs.Ticker();
		p = Animation.prototype;
		p._dirty = p._gc = p._initted = p._paused = false;
		p._totalTime = p._time = 0;
		p._rawPrevTime = -1;
		p._next = p._last = p._onUpdate = p._timeline = p.timeline = null;
		p._paused = false;


		//some browsers (like iOS) occasionally drop the requestAnimationFrame event when the user switches to a different tab and then comes back again, so we use a 2-second setTimeout() to sense if/when that condition occurs and then wake() the ticker.
		var _checkTimeout = function() {
				if (_tickerActive && _getTime() - _lastUpdate > 2000) {
					_ticker.wake();
				}
				setTimeout(_checkTimeout, 2000);
			};
		_checkTimeout();


		p.play = function(from, suppressEvents) {
			if (from != null) {
				this.seek(from, suppressEvents);
			}
			return this.reversed(false).paused(false);
		};

		p.pause = function(atTime, suppressEvents) {
			if (atTime != null) {
				this.seek(atTime, suppressEvents);
			}
			return this.paused(true);
		};

		p.resume = function(from, suppressEvents) {
			if (from != null) {
				this.seek(from, suppressEvents);
			}
			return this.paused(false);
		};

		p.seek = function(time, suppressEvents) {
			return this.totalTime(Number(time), suppressEvents !== false);
		};

		p.restart = function(includeDelay, suppressEvents) {
			return this.reversed(false).paused(false).totalTime(includeDelay ? -this._delay : 0, (suppressEvents !== false), true);
		};

		p.reverse = function(from, suppressEvents) {
			if (from != null) {
				this.seek((from || this.totalDuration()), suppressEvents);
			}
			return this.reversed(true).paused(false);
		};

		p.render = function(time, suppressEvents, force) {
			//stub - we override this method in subclasses.
		};

		p.invalidate = function() {
			this._time = this._totalTime = 0;
			this._initted = this._gc = false;
			this._rawPrevTime = -1;
			if (this._gc || !this.timeline) {
				this._enabled(true);
			}
			return this;
		};

		p.isActive = function() {
			var tl = this._timeline, //the 2 root timelines won't have a _timeline; they're always active.
				startTime = this._startTime,
				rawTime;
			return (!tl || (!this._gc && !this._paused && tl.isActive() && (rawTime = tl.rawTime()) >= startTime && rawTime < startTime + this.totalDuration() / this._timeScale));
		};

		p._enabled = function (enabled, ignoreTimeline) {
			if (!_tickerActive) {
				_ticker.wake();
			}
			this._gc = !enabled;
			this._active = this.isActive();
			if (ignoreTimeline !== true) {
				if (enabled && !this.timeline) {
					this._timeline.add(this, this._startTime - this._delay);
				} else if (!enabled && this.timeline) {
					this._timeline._remove(this, true);
				}
			}
			return false;
		};


		p._kill = function(vars, target) {
			return this._enabled(false, false);
		};

		p.kill = function(vars, target) {
			this._kill(vars, target);
			return this;
		};

		p._uncache = function(includeSelf) {
			var tween = includeSelf ? this : this.timeline;
			while (tween) {
				tween._dirty = true;
				tween = tween.timeline;
			}
			return this;
		};

		p._swapSelfInParams = function(params) {
			var i = params.length,
				copy = params.concat();
			while (--i > -1) {
				if (params[i] === "{self}") {
					copy[i] = this;
				}
			}
			return copy;
		};

//----Animation getters/setters --------------------------------------------------------

		p.eventCallback = function(type, callback, params, scope) {
			if ((type || "").substr(0,2) === "on") {
				var v = this.vars;
				if (arguments.length === 1) {
					return v[type];
				}
				if (callback == null) {
					delete v[type];
				} else {
					v[type] = callback;
					v[type + "Params"] = (_isArray(params) && params.join("").indexOf("{self}") !== -1) ? this._swapSelfInParams(params) : params;
					v[type + "Scope"] = scope;
				}
				if (type === "onUpdate") {
					this._onUpdate = callback;
				}
			}
			return this;
		};

		p.delay = function(value) {
			if (!arguments.length) {
				return this._delay;
			}
			if (this._timeline.smoothChildTiming) {
				this.startTime( this._startTime + value - this._delay );
			}
			this._delay = value;
			return this;
		};

		p.duration = function(value) {
			if (!arguments.length) {
				this._dirty = false;
				return this._duration;
			}
			this._duration = this._totalDuration = value;
			this._uncache(true); //true in case it's a TweenMax or TimelineMax that has a repeat - we'll need to refresh the totalDuration.
			if (this._timeline.smoothChildTiming) if (this._time > 0) if (this._time < this._duration) if (value !== 0) {
				this.totalTime(this._totalTime * (value / this._duration), true);
			}
			return this;
		};

		p.totalDuration = function(value) {
			this._dirty = false;
			return (!arguments.length) ? this._totalDuration : this.duration(value);
		};

		p.time = function(value, suppressEvents) {
			if (!arguments.length) {
				return this._time;
			}
			if (this._dirty) {
				this.totalDuration();
			}
			return this.totalTime((value > this._duration) ? this._duration : value, suppressEvents);
		};

		p.totalTime = function(time, suppressEvents, uncapped) {
			if (!_tickerActive) {
				_ticker.wake();
			}
			if (!arguments.length) {
				return this._totalTime;
			}
			if (this._timeline) {
				if (time < 0 && !uncapped) {
					time += this.totalDuration();
				}
				if (this._timeline.smoothChildTiming) {
					if (this._dirty) {
						this.totalDuration();
					}
					var totalDuration = this._totalDuration,
						tl = this._timeline;
					if (time > totalDuration && !uncapped) {
						time = totalDuration;
					}
					this._startTime = (this._paused ? this._pauseTime : tl._time) - ((!this._reversed ? time : totalDuration - time) / this._timeScale);
					if (!tl._dirty) { //for performance improvement. If the parent's cache is already dirty, it already took care of marking the ancestors as dirty too, so skip the function call here.
						this._uncache(false);
					}
					//in case any of the ancestor timelines had completed but should now be enabled, we should reset their totalTime() which will also ensure that they're lined up properly and enabled. Skip for animations that are on the root (wasteful). Example: a TimelineLite.exportRoot() is performed when there's a paused tween on the root, the export will not complete until that tween is unpaused, but imagine a child gets restarted later, after all [unpaused] tweens have completed. The startTime of that child would get pushed out, but one of the ancestors may have completed.
					if (tl._timeline) {
						while (tl._timeline) {
							if (tl._timeline._time !== (tl._startTime + tl._totalTime) / tl._timeScale) {
								tl.totalTime(tl._totalTime, true);
							}
							tl = tl._timeline;
						}
					}
				}
				if (this._gc) {
					this._enabled(true, false);
				}
				if (this._totalTime !== time || this._duration === 0) {
					this.render(time, suppressEvents, false);
					if (_lazyTweens.length) { //in case rendering caused any tweens to lazy-init, we should render them because typically when someone calls seek() or time() or progress(), they expect an immediate render.
						_lazyRender();
					}
				}
			}
			return this;
		};

		p.progress = p.totalProgress = function(value, suppressEvents) {
			return (!arguments.length) ? this._time / this.duration() : this.totalTime(this.duration() * value, suppressEvents);
		};

		p.startTime = function(value) {
			if (!arguments.length) {
				return this._startTime;
			}
			if (value !== this._startTime) {
				this._startTime = value;
				if (this.timeline) if (this.timeline._sortChildren) {
					this.timeline.add(this, value - this._delay); //ensures that any necessary re-sequencing of Animations in the timeline occurs to make sure the rendering order is correct.
				}
			}
			return this;
		};

		p.endTime = function(includeRepeats) {
			return this._startTime + ((includeRepeats != false) ? this.totalDuration() : this.duration()) / this._timeScale;
		};

		p.timeScale = function(value) {
			if (!arguments.length) {
				return this._timeScale;
			}
			value = value || _tinyNum; //can't allow zero because it'll throw the math off
			if (this._timeline && this._timeline.smoothChildTiming) {
				var pauseTime = this._pauseTime,
					t = (pauseTime || pauseTime === 0) ? pauseTime : this._timeline.totalTime();
				this._startTime = t - ((t - this._startTime) * this._timeScale / value);
			}
			this._timeScale = value;
			return this._uncache(false);
		};

		p.reversed = function(value) {
			if (!arguments.length) {
				return this._reversed;
			}
			if (value != this._reversed) {
				this._reversed = value;
				this.totalTime(((this._timeline && !this._timeline.smoothChildTiming) ? this.totalDuration() - this._totalTime : this._totalTime), true);
			}
			return this;
		};

		p.paused = function(value) {
			if (!arguments.length) {
				return this._paused;
			}
			if (value != this._paused) if (this._timeline) {
				if (!_tickerActive && !value) {
					_ticker.wake();
				}
				var tl = this._timeline,
					raw = tl.rawTime(),
					elapsed = raw - this._pauseTime;
				if (!value && tl.smoothChildTiming) {
					this._startTime += elapsed;
					this._uncache(false);
				}
				this._pauseTime = value ? raw : null;
				this._paused = value;
				this._active = this.isActive();
				if (!value && elapsed !== 0 && this._initted && this.duration()) {
					this.render((tl.smoothChildTiming ? this._totalTime : (raw - this._startTime) / this._timeScale), true, true); //in case the target's properties changed via some other tween or manual update by the user, we should force a render.
				}
			}
			if (this._gc && !value) {
				this._enabled(true, false);
			}
			return this;
		};


/*
 * ----------------------------------------------------------------
 * SimpleTimeline
 * ----------------------------------------------------------------
 */
		var SimpleTimeline = _class("core.SimpleTimeline", function(vars) {
			Animation.call(this, 0, vars);
			this.autoRemoveChildren = this.smoothChildTiming = true;
		});

		p = SimpleTimeline.prototype = new Animation();
		p.constructor = SimpleTimeline;
		p.kill()._gc = false;
		p._first = p._last = p._recent = null;
		p._sortChildren = false;

		p.add = p.insert = function(child, position, align, stagger) {
			var prevTween, st;
			child._startTime = Number(position || 0) + child._delay;
			if (child._paused) if (this !== child._timeline) { //we only adjust the _pauseTime if it wasn't in this timeline already. Remember, sometimes a tween will be inserted again into the same timeline when its startTime is changed so that the tweens in the TimelineLite/Max are re-ordered properly in the linked list (so everything renders in the proper order).
				child._pauseTime = child._startTime + ((this.rawTime() - child._startTime) / child._timeScale);
			}
			if (child.timeline) {
				child.timeline._remove(child, true); //removes from existing timeline so that it can be properly added to this one.
			}
			child.timeline = child._timeline = this;
			if (child._gc) {
				child._enabled(true, true);
			}
			prevTween = this._last;
			if (this._sortChildren) {
				st = child._startTime;
				while (prevTween && prevTween._startTime > st) {
					prevTween = prevTween._prev;
				}
			}
			if (prevTween) {
				child._next = prevTween._next;
				prevTween._next = child;
			} else {
				child._next = this._first;
				this._first = child;
			}
			if (child._next) {
				child._next._prev = child;
			} else {
				this._last = child;
			}
			child._prev = prevTween;
			this._recent = child;
			if (this._timeline) {
				this._uncache(true);
			}
			return this;
		};

		p._remove = function(tween, skipDisable) {
			if (tween.timeline === this) {
				if (!skipDisable) {
					tween._enabled(false, true);
				}

				if (tween._prev) {
					tween._prev._next = tween._next;
				} else if (this._first === tween) {
					this._first = tween._next;
				}
				if (tween._next) {
					tween._next._prev = tween._prev;
				} else if (this._last === tween) {
					this._last = tween._prev;
				}
				tween._next = tween._prev = tween.timeline = null;
				if (tween === this._recent) {
					this._recent = this._last;
				}

				if (this._timeline) {
					this._uncache(true);
				}
			}
			return this;
		};

		p.render = function(time, suppressEvents, force) {
			var tween = this._first,
				next;
			this._totalTime = this._time = this._rawPrevTime = time;
			while (tween) {
				next = tween._next; //record it here because the value could change after rendering...
				if (tween._active || (time >= tween._startTime && !tween._paused)) {
					if (!tween._reversed) {
						tween.render((time - tween._startTime) * tween._timeScale, suppressEvents, force);
					} else {
						tween.render(((!tween._dirty) ? tween._totalDuration : tween.totalDuration()) - ((time - tween._startTime) * tween._timeScale), suppressEvents, force);
					}
				}
				tween = next;
			}
		};

		p.rawTime = function() {
			if (!_tickerActive) {
				_ticker.wake();
			}
			return this._totalTime;
		};

/*
 * ----------------------------------------------------------------
 * TweenLite
 * ----------------------------------------------------------------
 */
		var TweenLite = _class("TweenLite", function(target, duration, vars) {
				Animation.call(this, duration, vars);
				this.render = TweenLite.prototype.render; //speed optimization (avoid prototype lookup on this "hot" method)

				if (target == null) {
					throw "Cannot tween a null target.";
				}

				this.target = target = (typeof(target) !== "string") ? target : TweenLite.selector(target) || target;

				var isSelector = (target.jquery || (target.length && target !== window && target[0] && (target[0] === window || (target[0].nodeType && target[0].style && !target.nodeType)))),
					overwrite = this.vars.overwrite,
					i, targ, targets;

				this._overwrite = overwrite = (overwrite == null) ? _overwriteLookup[TweenLite.defaultOverwrite] : (typeof(overwrite) === "number") ? overwrite >> 0 : _overwriteLookup[overwrite];

				if ((isSelector || target instanceof Array || (target.push && _isArray(target))) && typeof(target[0]) !== "number") {
					this._targets = targets = _slice(target);  //don't use Array.prototype.slice.call(target, 0) because that doesn't work in IE8 with a NodeList that's returned by querySelectorAll()
					this._propLookup = [];
					this._siblings = [];
					for (i = 0; i < targets.length; i++) {
						targ = targets[i];
						if (!targ) {
							targets.splice(i--, 1);
							continue;
						} else if (typeof(targ) === "string") {
							targ = targets[i--] = TweenLite.selector(targ); //in case it's an array of strings
							if (typeof(targ) === "string") {
								targets.splice(i+1, 1); //to avoid an endless loop (can't imagine why the selector would return a string, but just in case)
							}
							continue;
						} else if (targ.length && targ !== window && targ[0] && (targ[0] === window || (targ[0].nodeType && targ[0].style && !targ.nodeType))) { //in case the user is passing in an array of selector objects (like jQuery objects), we need to check one more level and pull things out if necessary. Also note that <select> elements pass all the criteria regarding length and the first child having style, so we must also check to ensure the target isn't an HTML node itself.
							targets.splice(i--, 1);
							this._targets = targets = targets.concat(_slice(targ));
							continue;
						}
						this._siblings[i] = _register(targ, this, false);
						if (overwrite === 1) if (this._siblings[i].length > 1) {
							_applyOverwrite(targ, this, null, 1, this._siblings[i]);
						}
					}

				} else {
					this._propLookup = {};
					this._siblings = _register(target, this, false);
					if (overwrite === 1) if (this._siblings.length > 1) {
						_applyOverwrite(target, this, null, 1, this._siblings);
					}
				}
				if (this.vars.immediateRender || (duration === 0 && this._delay === 0 && this.vars.immediateRender !== false)) {
					this._time = -_tinyNum; //forces a render without having to set the render() "force" parameter to true because we want to allow lazying by default (using the "force" parameter always forces an immediate full render)
					this.render(-this._delay);
				}
			}, true),
			_isSelector = function(v) {
				return (v && v.length && v !== window && v[0] && (v[0] === window || (v[0].nodeType && v[0].style && !v.nodeType))); //we cannot check "nodeType" if the target is window from within an iframe, otherwise it will trigger a security error in some browsers like Firefox.
			},
			_autoCSS = function(vars, target) {
				var css = {},
					p;
				for (p in vars) {
					if (!_reservedProps[p] && (!(p in target) || p === "transform" || p === "x" || p === "y" || p === "width" || p === "height" || p === "className" || p === "border") && (!_plugins[p] || (_plugins[p] && _plugins[p]._autoCSS))) { //note: <img> elements contain read-only "x" and "y" properties. We should also prioritize editing css width/height rather than the element's properties.
						css[p] = vars[p];
						delete vars[p];
					}
				}
				vars.css = css;
			};

		p = TweenLite.prototype = new Animation();
		p.constructor = TweenLite;
		p.kill()._gc = false;

//----TweenLite defaults, overwrite management, and root updates ----------------------------------------------------

		p.ratio = 0;
		p._firstPT = p._targets = p._overwrittenProps = p._startAt = null;
		p._notifyPluginsOfEnabled = p._lazy = false;

		TweenLite.version = "1.15.0";
		TweenLite.defaultEase = p._ease = new Ease(null, null, 1, 1);
		TweenLite.defaultOverwrite = "auto";
		TweenLite.ticker = _ticker;
		TweenLite.autoSleep = true;
		TweenLite.lagSmoothing = function(threshold, adjustedLag) {
			_ticker.lagSmoothing(threshold, adjustedLag);
		};

		TweenLite.selector = window.$ || window.jQuery || function(e) {
			var selector = window.$ || window.jQuery;
			if (selector) {
				TweenLite.selector = selector;
				return selector(e);
			}
			return (typeof(document) === "undefined") ? e : (document.querySelectorAll ? document.querySelectorAll(e) : document.getElementById((e.charAt(0) === "#") ? e.substr(1) : e));
		};

		var _lazyTweens = [],
			_lazyLookup = {},
			_internals = TweenLite._internals = {isArray:_isArray, isSelector:_isSelector, lazyTweens:_lazyTweens}, //gives us a way to expose certain private values to other GreenSock classes without contaminating tha main TweenLite object.
			_plugins = TweenLite._plugins = {},
			_tweenLookup = _internals.tweenLookup = {},
			_tweenLookupNum = 0,
			_reservedProps = _internals.reservedProps = {ease:1, delay:1, overwrite:1, onComplete:1, onCompleteParams:1, onCompleteScope:1, useFrames:1, runBackwards:1, startAt:1, onUpdate:1, onUpdateParams:1, onUpdateScope:1, onStart:1, onStartParams:1, onStartScope:1, onReverseComplete:1, onReverseCompleteParams:1, onReverseCompleteScope:1, onRepeat:1, onRepeatParams:1, onRepeatScope:1, easeParams:1, yoyo:1, immediateRender:1, repeat:1, repeatDelay:1, data:1, paused:1, reversed:1, autoCSS:1, lazy:1, onOverwrite:1},
			_overwriteLookup = {none:0, all:1, auto:2, concurrent:3, allOnStart:4, preexisting:5, "true":1, "false":0},
			_rootFramesTimeline = Animation._rootFramesTimeline = new SimpleTimeline(),
			_rootTimeline = Animation._rootTimeline = new SimpleTimeline(),
			_lazyRender = _internals.lazyRender = function() {
				var i = _lazyTweens.length,
					tween;
				_lazyLookup = {};
				while (--i > -1) {
					tween = _lazyTweens[i];
					if (tween && tween._lazy !== false) {
						tween.render(tween._lazy[0], tween._lazy[1], true);
						tween._lazy = false;
					}
				}
				_lazyTweens.length = 0;
			};

		_rootTimeline._startTime = _ticker.time;
		_rootFramesTimeline._startTime = _ticker.frame;
		_rootTimeline._active = _rootFramesTimeline._active = true;
		setTimeout(_lazyRender, 1); //on some mobile devices, there isn't a "tick" before code runs which means any lazy renders wouldn't run before the next official "tick".

		Animation._updateRoot = TweenLite.render = function() {
				var i, a, p;
				if (_lazyTweens.length) { //if code is run outside of the requestAnimationFrame loop, there may be tweens queued AFTER the engine refreshed, so we need to ensure any pending renders occur before we refresh again.
					_lazyRender();
				}
				_rootTimeline.render((_ticker.time - _rootTimeline._startTime) * _rootTimeline._timeScale, false, false);
				_rootFramesTimeline.render((_ticker.frame - _rootFramesTimeline._startTime) * _rootFramesTimeline._timeScale, false, false);
				if (_lazyTweens.length) {
					_lazyRender();
				}
				if (!(_ticker.frame % 120)) { //dump garbage every 120 frames...
					for (p in _tweenLookup) {
						a = _tweenLookup[p].tweens;
						i = a.length;
						while (--i > -1) {
							if (a[i]._gc) {
								a.splice(i, 1);
							}
						}
						if (a.length === 0) {
							delete _tweenLookup[p];
						}
					}
					//if there are no more tweens in the root timelines, or if they're all paused, make the _timer sleep to reduce load on the CPU slightly
					p = _rootTimeline._first;
					if (!p || p._paused) if (TweenLite.autoSleep && !_rootFramesTimeline._first && _ticker._listeners.tick.length === 1) {
						while (p && p._paused) {
							p = p._next;
						}
						if (!p) {
							_ticker.sleep();
						}
					}
				}
			};

		_ticker.addEventListener("tick", Animation._updateRoot);

		var _register = function(target, tween, scrub) {
				var id = target._gsTweenID, a, i;
				if (!_tweenLookup[id || (target._gsTweenID = id = "t" + (_tweenLookupNum++))]) {
					_tweenLookup[id] = {target:target, tweens:[]};
				}
				if (tween) {
					a = _tweenLookup[id].tweens;
					a[(i = a.length)] = tween;
					if (scrub) {
						while (--i > -1) {
							if (a[i] === tween) {
								a.splice(i, 1);
							}
						}
					}
				}
				return _tweenLookup[id].tweens;
			},

			_onOverwrite = function(overwrittenTween, overwritingTween, target, killedProps) {
				var func = overwrittenTween.vars.onOverwrite, r1, r2;
				if (func) {
					r1 = func(overwrittenTween, overwritingTween, target, killedProps);
				}
				func = TweenLite.onOverwrite;
				if (func) {
					r2 = func(overwrittenTween, overwritingTween, target, killedProps);
				}
				return (r1 !== false && r2 !== false);
			},
			_applyOverwrite = function(target, tween, props, mode, siblings) {
				var i, changed, curTween, l;
				if (mode === 1 || mode >= 4) {
					l = siblings.length;
					for (i = 0; i < l; i++) {
						if ((curTween = siblings[i]) !== tween) {
							if (!curTween._gc) {
								if (_onOverwrite(curTween, tween) && curTween._enabled(false, false)) {
									changed = true;
								}
							}
						} else if (mode === 5) {
							break;
						}
					}
					return changed;
				}
				//NOTE: Add 0.0000000001 to overcome floating point errors that can cause the startTime to be VERY slightly off (when a tween's time() is set for example)
				var startTime = tween._startTime + _tinyNum,
					overlaps = [],
					oCount = 0,
					zeroDur = (tween._duration === 0),
					globalStart;
				i = siblings.length;
				while (--i > -1) {
					if ((curTween = siblings[i]) === tween || curTween._gc || curTween._paused) {
						//ignore
					} else if (curTween._timeline !== tween._timeline) {
						globalStart = globalStart || _checkOverlap(tween, 0, zeroDur);
						if (_checkOverlap(curTween, globalStart, zeroDur) === 0) {
							overlaps[oCount++] = curTween;
						}
					} else if (curTween._startTime <= startTime) if (curTween._startTime + curTween.totalDuration() / curTween._timeScale > startTime) if (!((zeroDur || !curTween._initted) && startTime - curTween._startTime <= 0.0000000002)) {
						overlaps[oCount++] = curTween;
					}
				}

				i = oCount;
				while (--i > -1) {
					curTween = overlaps[i];
					if (mode === 2) if (curTween._kill(props, target, tween)) {
						changed = true;
					}
					if (mode !== 2 || (!curTween._firstPT && curTween._initted)) {
						if (mode !== 2 && !_onOverwrite(curTween, tween)) {
							continue;
						}
						if (curTween._enabled(false, false)) { //if all property tweens have been overwritten, kill the tween.
							changed = true;
						}
					}
				}
				return changed;
			},

			_checkOverlap = function(tween, reference, zeroDur) {
				var tl = tween._timeline,
					ts = tl._timeScale,
					t = tween._startTime;
				while (tl._timeline) {
					t += tl._startTime;
					ts *= tl._timeScale;
					if (tl._paused) {
						return -100;
					}
					tl = tl._timeline;
				}
				t /= ts;
				return (t > reference) ? t - reference : ((zeroDur && t === reference) || (!tween._initted && t - reference < 2 * _tinyNum)) ? _tinyNum : ((t += tween.totalDuration() / tween._timeScale / ts) > reference + _tinyNum) ? 0 : t - reference - _tinyNum;
			};


//---- TweenLite instance methods -----------------------------------------------------------------------------

		p._init = function() {
			var v = this.vars,
				op = this._overwrittenProps,
				dur = this._duration,
				immediate = !!v.immediateRender,
				ease = v.ease,
				i, initPlugins, pt, p, startVars;
			if (v.startAt) {
				if (this._startAt) {
					this._startAt.render(-1, true); //if we've run a startAt previously (when the tween instantiated), we should revert it so that the values re-instantiate correctly particularly for relative tweens. Without this, a TweenLite.fromTo(obj, 1, {x:"+=100"}, {x:"-=100"}), for example, would actually jump to +=200 because the startAt would run twice, doubling the relative change.
					this._startAt.kill();
				}
				startVars = {};
				for (p in v.startAt) { //copy the properties/values into a new object to avoid collisions, like var to = {x:0}, from = {x:500}; timeline.fromTo(e, 1, from, to).fromTo(e, 1, to, from);
					startVars[p] = v.startAt[p];
				}
				startVars.overwrite = false;
				startVars.immediateRender = true;
				startVars.lazy = (immediate && v.lazy !== false);
				startVars.startAt = startVars.delay = null; //no nesting of startAt objects allowed (otherwise it could cause an infinite loop).
				this._startAt = TweenLite.to(this.target, 0, startVars);
				if (immediate) {
					if (this._time > 0) {
						this._startAt = null; //tweens that render immediately (like most from() and fromTo() tweens) shouldn't revert when their parent timeline's playhead goes backward past the startTime because the initial render could have happened anytime and it shouldn't be directly correlated to this tween's startTime. Imagine setting up a complex animation where the beginning states of various objects are rendered immediately but the tween doesn't happen for quite some time - if we revert to the starting values as soon as the playhead goes backward past the tween's startTime, it will throw things off visually. Reversion should only happen in TimelineLite/Max instances where immediateRender was false (which is the default in the convenience methods like from()).
					} else if (dur !== 0) {
						return; //we skip initialization here so that overwriting doesn't occur until the tween actually begins. Otherwise, if you create several immediateRender:true tweens of the same target/properties to drop into a TimelineLite or TimelineMax, the last one created would overwrite the first ones because they didn't get placed into the timeline yet before the first render occurs and kicks in overwriting.
					}
				}
			} else if (v.runBackwards && dur !== 0) {
				//from() tweens must be handled uniquely: their beginning values must be rendered but we don't want overwriting to occur yet (when time is still 0). Wait until the tween actually begins before doing all the routines like overwriting. At that time, we should render at the END of the tween to ensure that things initialize correctly (remember, from() tweens go backwards)
				if (this._startAt) {
					this._startAt.render(-1, true);
					this._startAt.kill();
					this._startAt = null;
				} else {
					if (this._time !== 0) { //in rare cases (like if a from() tween runs and then is invalidate()-ed), immediateRender could be true but the initial forced-render gets skipped, so there's no need to force the render in this context when the _time is greater than 0
						immediate = false;
					}
					pt = {};
					for (p in v) { //copy props into a new object and skip any reserved props, otherwise onComplete or onUpdate or onStart could fire. We should, however, permit autoCSS to go through.
						if (!_reservedProps[p] || p === "autoCSS") {
							pt[p] = v[p];
						}
					}
					pt.overwrite = 0;
					pt.data = "isFromStart"; //we tag the tween with as "isFromStart" so that if [inside a plugin] we need to only do something at the very END of a tween, we have a way of identifying this tween as merely the one that's setting the beginning values for a "from()" tween. For example, clearProps in CSSPlugin should only get applied at the very END of a tween and without this tag, from(...{height:100, clearProps:"height", delay:1}) would wipe the height at the beginning of the tween and after 1 second, it'd kick back in.
					pt.lazy = (immediate && v.lazy !== false);
					pt.immediateRender = immediate; //zero-duration tweens render immediately by default, but if we're not specifically instructed to render this tween immediately, we should skip this and merely _init() to record the starting values (rendering them immediately would push them to completion which is wasteful in that case - we'd have to render(-1) immediately after)
					this._startAt = TweenLite.to(this.target, 0, pt);
					if (!immediate) {
						this._startAt._init(); //ensures that the initial values are recorded
						this._startAt._enabled(false); //no need to have the tween render on the next cycle. Disable it because we'll always manually control the renders of the _startAt tween.
						if (this.vars.immediateRender) {
							this._startAt = null;
						}
					} else if (this._time === 0) {
						return;
					}
				}
			}
			this._ease = ease = (!ease) ? TweenLite.defaultEase : (ease instanceof Ease) ? ease : (typeof(ease) === "function") ? new Ease(ease, v.easeParams) : _easeMap[ease] || TweenLite.defaultEase;
			if (v.easeParams instanceof Array && ease.config) {
				this._ease = ease.config.apply(ease, v.easeParams);
			}
			this._easeType = this._ease._type;
			this._easePower = this._ease._power;
			this._firstPT = null;

			if (this._targets) {
				i = this._targets.length;
				while (--i > -1) {
					if ( this._initProps( this._targets[i], (this._propLookup[i] = {}), this._siblings[i], (op ? op[i] : null)) ) {
						initPlugins = true;
					}
				}
			} else {
				initPlugins = this._initProps(this.target, this._propLookup, this._siblings, op);
			}

			if (initPlugins) {
				TweenLite._onPluginEvent("_onInitAllProps", this); //reorders the array in order of priority. Uses a static TweenPlugin method in order to minimize file size in TweenLite
			}
			if (op) if (!this._firstPT) if (typeof(this.target) !== "function") { //if all tweening properties have been overwritten, kill the tween. If the target is a function, it's probably a delayedCall so let it live.
				this._enabled(false, false);
			}
			if (v.runBackwards) {
				pt = this._firstPT;
				while (pt) {
					pt.s += pt.c;
					pt.c = -pt.c;
					pt = pt._next;
				}
			}
			this._onUpdate = v.onUpdate;
			this._initted = true;
		};

		p._initProps = function(target, propLookup, siblings, overwrittenProps) {
			var p, i, initPlugins, plugin, pt, v;
			if (target == null) {
				return false;
			}

			if (_lazyLookup[target._gsTweenID]) {
				_lazyRender(); //if other tweens of the same target have recently initted but haven't rendered yet, we've got to force the render so that the starting values are correct (imagine populating a timeline with a bunch of sequential tweens and then jumping to the end)
			}

			if (!this.vars.css) if (target.style) if (target !== window && target.nodeType) if (_plugins.css) if (this.vars.autoCSS !== false) { //it's so common to use TweenLite/Max to animate the css of DOM elements, we assume that if the target is a DOM element, that's what is intended (a convenience so that users don't have to wrap things in css:{}, although we still recommend it for a slight performance boost and better specificity). Note: we cannot check "nodeType" on the window inside an iframe.
				_autoCSS(this.vars, target);
			}
			for (p in this.vars) {
				v = this.vars[p];
				if (_reservedProps[p]) {
					if (v) if ((v instanceof Array) || (v.push && _isArray(v))) if (v.join("").indexOf("{self}") !== -1) {
						this.vars[p] = v = this._swapSelfInParams(v, this);
					}

				} else if (_plugins[p] && (plugin = new _plugins[p]())._onInitTween(target, this.vars[p], this)) {

					//t - target 		[object]
					//p - property 		[string]
					//s - start			[number]
					//c - change		[number]
					//f - isFunction	[boolean]
					//n - name			[string]
					//pg - isPlugin 	[boolean]
					//pr - priority		[number]
					this._firstPT = pt = {_next:this._firstPT, t:plugin, p:"setRatio", s:0, c:1, f:true, n:p, pg:true, pr:plugin._priority};
					i = plugin._overwriteProps.length;
					while (--i > -1) {
						propLookup[plugin._overwriteProps[i]] = this._firstPT;
					}
					if (plugin._priority || plugin._onInitAllProps) {
						initPlugins = true;
					}
					if (plugin._onDisable || plugin._onEnable) {
						this._notifyPluginsOfEnabled = true;
					}

				} else {
					this._firstPT = propLookup[p] = pt = {_next:this._firstPT, t:target, p:p, f:(typeof(target[p]) === "function"), n:p, pg:false, pr:0};
					pt.s = (!pt.f) ? parseFloat(target[p]) : target[ ((p.indexOf("set") || typeof(target["get" + p.substr(3)]) !== "function") ? p : "get" + p.substr(3)) ]();
					pt.c = (typeof(v) === "string" && v.charAt(1) === "=") ? parseInt(v.charAt(0) + "1", 10) * Number(v.substr(2)) : (Number(v) - pt.s) || 0;
				}
				if (pt) if (pt._next) {
					pt._next._prev = pt;
				}
			}

			if (overwrittenProps) if (this._kill(overwrittenProps, target)) { //another tween may have tried to overwrite properties of this tween before init() was called (like if two tweens start at the same time, the one created second will run first)
				return this._initProps(target, propLookup, siblings, overwrittenProps);
			}
			if (this._overwrite > 1) if (this._firstPT) if (siblings.length > 1) if (_applyOverwrite(target, this, propLookup, this._overwrite, siblings)) {
				this._kill(propLookup, target);
				return this._initProps(target, propLookup, siblings, overwrittenProps);
			}
			if (this._firstPT) if ((this.vars.lazy !== false && this._duration) || (this.vars.lazy && !this._duration)) { //zero duration tweens don't lazy render by default; everything else does.
				_lazyLookup[target._gsTweenID] = true;
			}
			return initPlugins;
		};

		p.render = function(time, suppressEvents, force) {
			var prevTime = this._time,
				duration = this._duration,
				prevRawPrevTime = this._rawPrevTime,
				isComplete, callback, pt, rawPrevTime;
			if (time >= duration) {
				this._totalTime = this._time = duration;
				this.ratio = this._ease._calcEnd ? this._ease.getRatio(1) : 1;
				if (!this._reversed ) {
					isComplete = true;
					callback = "onComplete";
				}
				if (duration === 0) if (this._initted || !this.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
					if (this._startTime === this._timeline._duration) { //if a zero-duration tween is at the VERY end of a timeline and that timeline renders at its end, it will typically add a tiny bit of cushion to the render time to prevent rounding errors from getting in the way of tweens rendering their VERY end. If we then reverse() that timeline, the zero-duration tween will trigger its onReverseComplete even though technically the playhead didn't pass over it again. It's a very specific edge case we must accommodate.
						time = 0;
					}
					if (time === 0 || prevRawPrevTime < 0 || (prevRawPrevTime === _tinyNum && this.data !== "isPause")) if (prevRawPrevTime !== time) { //note: when this.data is "isPause", it's a callback added by addPause() on a timeline that we should not be triggered when LEAVING its exact start time. In other words, tl.addPause(1).play(1) shouldn't pause.
						force = true;
						if (prevRawPrevTime > _tinyNum) {
							callback = "onReverseComplete";
						}
					}
					this._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
				}

			} else if (time < 0.0000001) { //to work around occasional floating point math artifacts, round super small values to 0.
				this._totalTime = this._time = 0;
				this.ratio = this._ease._calcEnd ? this._ease.getRatio(0) : 0;
				if (prevTime !== 0 || (duration === 0 && prevRawPrevTime > 0 && prevRawPrevTime !== _tinyNum)) {
					callback = "onReverseComplete";
					isComplete = this._reversed;
				}
				if (time < 0) {
					this._active = false;
					if (duration === 0) if (this._initted || !this.vars.lazy || force) { //zero-duration tweens are tricky because we must discern the momentum/direction of time in order to determine whether the starting values should be rendered or the ending values. If the "playhead" of its timeline goes past the zero-duration tween in the forward direction or lands directly on it, the end values should be rendered, but if the timeline's "playhead" moves past it in the backward direction (from a postitive time to a negative time), the starting values must be rendered.
						if (prevRawPrevTime >= 0 && !(prevRawPrevTime === _tinyNum && this.data === "isPause")) {
							force = true;
						}
						this._rawPrevTime = rawPrevTime = (!suppressEvents || time || prevRawPrevTime === time) ? time : _tinyNum; //when the playhead arrives at EXACTLY time 0 (right on top) of a zero-duration tween, we need to discern if events are suppressed so that when the playhead moves again (next time), it'll trigger the callback. If events are NOT suppressed, obviously the callback would be triggered in this render. Basically, the callback should fire either when the playhead ARRIVES or LEAVES this exact spot, not both. Imagine doing a timeline.seek(0) and there's a callback that sits at 0. Since events are suppressed on that seek() by default, nothing will fire, but when the playhead moves off of that position, the callback should fire. This behavior is what people intuitively expect. We set the _rawPrevTime to be a precise tiny number to indicate this scenario rather than using another property/variable which would increase memory usage. This technique is less readable, but more efficient.
					}
				}
				if (!this._initted) { //if we render the very beginning (time == 0) of a fromTo(), we must force the render (normal tweens wouldn't need to render at a time of 0 when the prevTime was also 0). This is also mandatory to make sure overwriting kicks in immediately.
					force = true;
				}
			} else {
				this._totalTime = this._time = time;

				if (this._easeType) {
					var r = time / duration, type = this._easeType, pow = this._easePower;
					if (type === 1 || (type === 3 && r >= 0.5)) {
						r = 1 - r;
					}
					if (type === 3) {
						r *= 2;
					}
					if (pow === 1) {
						r *= r;
					} else if (pow === 2) {
						r *= r * r;
					} else if (pow === 3) {
						r *= r * r * r;
					} else if (pow === 4) {
						r *= r * r * r * r;
					}

					if (type === 1) {
						this.ratio = 1 - r;
					} else if (type === 2) {
						this.ratio = r;
					} else if (time / duration < 0.5) {
						this.ratio = r / 2;
					} else {
						this.ratio = 1 - (r / 2);
					}

				} else {
					this.ratio = this._ease.getRatio(time / duration);
				}
			}

			if (this._time === prevTime && !force) {
				return;
			} else if (!this._initted) {
				this._init();
				if (!this._initted || this._gc) { //immediateRender tweens typically won't initialize until the playhead advances (_time is greater than 0) in order to ensure that overwriting occurs properly. Also, if all of the tweening properties have been overwritten (which would cause _gc to be true, as set in _init()), we shouldn't continue otherwise an onStart callback could be called for example.
					return;
				} else if (!force && this._firstPT && ((this.vars.lazy !== false && this._duration) || (this.vars.lazy && !this._duration))) {
					this._time = this._totalTime = prevTime;
					this._rawPrevTime = prevRawPrevTime;
					_lazyTweens.push(this);
					this._lazy = [time, suppressEvents];
					return;
				}
				//_ease is initially set to defaultEase, so now that init() has run, _ease is set properly and we need to recalculate the ratio. Overall this is faster than using conditional logic earlier in the method to avoid having to set ratio twice because we only init() once but renderTime() gets called VERY frequently.
				if (this._time && !isComplete) {
					this.ratio = this._ease.getRatio(this._time / duration);
				} else if (isComplete && this._ease._calcEnd) {
					this.ratio = this._ease.getRatio((this._time === 0) ? 0 : 1);
				}
			}
			if (this._lazy !== false) { //in case a lazy render is pending, we should flush it because the new render is occurring now (imagine a lazy tween instantiating and then immediately the user calls tween.seek(tween.duration()), skipping to the end - the end render would be forced, and then if we didn't flush the lazy render, it'd fire AFTER the seek(), rendering it at the wrong time.
				this._lazy = false;
			}
			if (!this._active) if (!this._paused && this._time !== prevTime && time >= 0) {
				this._active = true;  //so that if the user renders a tween (as opposed to the timeline rendering it), the timeline is forced to re-render and align it with the proper time/frame on the next rendering cycle. Maybe the tween already finished but the user manually re-renders it as halfway done.
			}
			if (prevTime === 0) {
				if (this._startAt) {
					if (time >= 0) {
						this._startAt.render(time, suppressEvents, force);
					} else if (!callback) {
						callback = "_dummyGS"; //if no callback is defined, use a dummy value just so that the condition at the end evaluates as true because _startAt should render AFTER the normal render loop when the time is negative. We could handle this in a more intuitive way, of course, but the render loop is the MOST important thing to optimize, so this technique allows us to avoid adding extra conditional logic in a high-frequency area.
					}
				}
				if (this.vars.onStart) if (this._time !== 0 || duration === 0) if (!suppressEvents) {
					this.vars.onStart.apply(this.vars.onStartScope || this, this.vars.onStartParams || _blankArray);
				}
			}
			pt = this._firstPT;
			while (pt) {
				if (pt.f) {
					pt.t[pt.p](pt.c * this.ratio + pt.s);
				} else {
					pt.t[pt.p] = pt.c * this.ratio + pt.s;
				}
				pt = pt._next;
			}

			if (this._onUpdate) {
				if (time < 0) if (this._startAt && time !== -0.0001) { //if the tween is positioned at the VERY beginning (_startTime 0) of its parent timeline, it's illegal for the playhead to go back further, so we should not render the recorded startAt values.
					this._startAt.render(time, suppressEvents, force); //note: for performance reasons, we tuck this conditional logic inside less traveled areas (most tweens don't have an onUpdate). We'd just have it at the end before the onComplete, but the values should be updated before any onUpdate is called, so we ALSO put it here and then if it's not called, we do so later near the onComplete.
				}
				if (!suppressEvents) if (this._time !== prevTime || isComplete) {
					this._onUpdate.apply(this.vars.onUpdateScope || this, this.vars.onUpdateParams || _blankArray);
				}
			}
			if (callback) if (!this._gc || force) { //check _gc because there's a chance that kill() could be called in an onUpdate
				if (time < 0 && this._startAt && !this._onUpdate && time !== -0.0001) { //-0.0001 is a special value that we use when looping back to the beginning of a repeated TimelineMax, in which case we shouldn't render the _startAt values.
					this._startAt.render(time, suppressEvents, force);
				}
				if (isComplete) {
					if (this._timeline.autoRemoveChildren) {
						this._enabled(false, false);
					}
					this._active = false;
				}
				if (!suppressEvents && this.vars[callback]) {
					this.vars[callback].apply(this.vars[callback + "Scope"] || this, this.vars[callback + "Params"] || _blankArray);
				}
				if (duration === 0 && this._rawPrevTime === _tinyNum && rawPrevTime !== _tinyNum) { //the onComplete or onReverseComplete could trigger movement of the playhead and for zero-duration tweens (which must discern direction) that land directly back on their start time, we don't want to fire again on the next render. Think of several addPause()'s in a timeline that forces the playhead to a certain spot, but what if it's already paused and another tween is tweening the "time" of the timeline? Each time it moves [forward] past that spot, it would move back, and since suppressEvents is true, it'd reset _rawPrevTime to _tinyNum so that when it begins again, the callback would fire (so ultimately it could bounce back and forth during that tween). Again, this is a very uncommon scenario, but possible nonetheless.
					this._rawPrevTime = 0;
				}
			}
		};

		p._kill = function(vars, target, overwritingTween) {
			if (vars === "all") {
				vars = null;
			}
			if (vars == null) if (target == null || target === this.target) {
				this._lazy = false;
				return this._enabled(false, false);
			}
			target = (typeof(target) !== "string") ? (target || this._targets || this.target) : TweenLite.selector(target) || target;
			var i, overwrittenProps, p, pt, propLookup, changed, killProps, record, killed;
			if ((_isArray(target) || _isSelector(target)) && typeof(target[0]) !== "number") {
				i = target.length;
				while (--i > -1) {
					if (this._kill(vars, target[i])) {
						changed = true;
					}
				}
			} else {
				if (this._targets) {
					i = this._targets.length;
					while (--i > -1) {
						if (target === this._targets[i]) {
							propLookup = this._propLookup[i] || {};
							this._overwrittenProps = this._overwrittenProps || [];
							overwrittenProps = this._overwrittenProps[i] = vars ? this._overwrittenProps[i] || {} : "all";
							break;
						}
					}
				} else if (target !== this.target) {
					return false;
				} else {
					propLookup = this._propLookup;
					overwrittenProps = this._overwrittenProps = vars ? this._overwrittenProps || {} : "all";
				}

				if (propLookup) {
					killProps = vars || propLookup;
					record = (vars !== overwrittenProps && overwrittenProps !== "all" && vars !== propLookup && (typeof(vars) !== "object" || !vars._tempKill)); //_tempKill is a super-secret way to delete a particular tweening property but NOT have it remembered as an official overwritten property (like in BezierPlugin)
					if (overwritingTween && (TweenLite.onOverwrite || this.vars.onOverwrite)) {
						for (p in killProps) {
							if (propLookup[p]) {
								if (!killed) {
									killed = [];
								}
								killed.push(p);
							}
						}
						if (!_onOverwrite(this, overwritingTween, target, killed)) { //if the onOverwrite returned false, that means the user wants to override the overwriting (cancel it).
							return false;
						}
					}

					for (p in killProps) {
						if ((pt = propLookup[p])) {
							if (pt.pg && pt.t._kill(killProps)) {
								changed = true; //some plugins need to be notified so they can perform cleanup tasks first
							}
							if (!pt.pg || pt.t._overwriteProps.length === 0) {
								if (pt._prev) {
									pt._prev._next = pt._next;
								} else if (pt === this._firstPT) {
									this._firstPT = pt._next;
								}
								if (pt._next) {
									pt._next._prev = pt._prev;
								}
								pt._next = pt._prev = null;
							}
							delete propLookup[p];
						}
						if (record) {
							overwrittenProps[p] = 1;
						}
					}
					if (!this._firstPT && this._initted) { //if all tweening properties are killed, kill the tween. Without this line, if there's a tween with multiple targets and then you killTweensOf() each target individually, the tween would technically still remain active and fire its onComplete even though there aren't any more properties tweening.
						this._enabled(false, false);
					}
				}
			}
			return changed;
		};

		p.invalidate = function() {
			if (this._notifyPluginsOfEnabled) {
				TweenLite._onPluginEvent("_onDisable", this);
			}
			this._firstPT = this._overwrittenProps = this._startAt = this._onUpdate = null;
			this._notifyPluginsOfEnabled = this._active = this._lazy = false;
			this._propLookup = (this._targets) ? {} : [];
			Animation.prototype.invalidate.call(this);
			if (this.vars.immediateRender) {
				this._time = -_tinyNum; //forces a render without having to set the render() "force" parameter to true because we want to allow lazying by default (using the "force" parameter always forces an immediate full render)
				this.render(-this._delay);
			}
			return this;
		};

		p._enabled = function(enabled, ignoreTimeline) {
			if (!_tickerActive) {
				_ticker.wake();
			}
			if (enabled && this._gc) {
				var targets = this._targets,
					i;
				if (targets) {
					i = targets.length;
					while (--i > -1) {
						this._siblings[i] = _register(targets[i], this, true);
					}
				} else {
					this._siblings = _register(this.target, this, true);
				}
			}
			Animation.prototype._enabled.call(this, enabled, ignoreTimeline);
			if (this._notifyPluginsOfEnabled) if (this._firstPT) {
				return TweenLite._onPluginEvent((enabled ? "_onEnable" : "_onDisable"), this);
			}
			return false;
		};


//----TweenLite static methods -----------------------------------------------------

		TweenLite.to = function(target, duration, vars) {
			return new TweenLite(target, duration, vars);
		};

		TweenLite.from = function(target, duration, vars) {
			vars.runBackwards = true;
			vars.immediateRender = (vars.immediateRender != false);
			return new TweenLite(target, duration, vars);
		};

		TweenLite.fromTo = function(target, duration, fromVars, toVars) {
			toVars.startAt = fromVars;
			toVars.immediateRender = (toVars.immediateRender != false && fromVars.immediateRender != false);
			return new TweenLite(target, duration, toVars);
		};

		TweenLite.delayedCall = function(delay, callback, params, scope, useFrames) {
			return new TweenLite(callback, 0, {delay:delay, onComplete:callback, onCompleteParams:params, onCompleteScope:scope, onReverseComplete:callback, onReverseCompleteParams:params, onReverseCompleteScope:scope, immediateRender:false, lazy:false, useFrames:useFrames, overwrite:0});
		};

		TweenLite.set = function(target, vars) {
			return new TweenLite(target, 0, vars);
		};

		TweenLite.getTweensOf = function(target, onlyActive) {
			if (target == null) { return []; }
			target = (typeof(target) !== "string") ? target : TweenLite.selector(target) || target;
			var i, a, j, t;
			if ((_isArray(target) || _isSelector(target)) && typeof(target[0]) !== "number") {
				i = target.length;
				a = [];
				while (--i > -1) {
					a = a.concat(TweenLite.getTweensOf(target[i], onlyActive));
				}
				i = a.length;
				//now get rid of any duplicates (tweens of arrays of objects could cause duplicates)
				while (--i > -1) {
					t = a[i];
					j = i;
					while (--j > -1) {
						if (t === a[j]) {
							a.splice(i, 1);
						}
					}
				}
			} else {
				a = _register(target).concat();
				i = a.length;
				while (--i > -1) {
					if (a[i]._gc || (onlyActive && !a[i].isActive())) {
						a.splice(i, 1);
					}
				}
			}
			return a;
		};

		TweenLite.killTweensOf = TweenLite.killDelayedCallsTo = function(target, onlyActive, vars) {
			if (typeof(onlyActive) === "object") {
				vars = onlyActive; //for backwards compatibility (before "onlyActive" parameter was inserted)
				onlyActive = false;
			}
			var a = TweenLite.getTweensOf(target, onlyActive),
				i = a.length;
			while (--i > -1) {
				a[i]._kill(vars, target);
			}
		};



/*
 * ----------------------------------------------------------------
 * TweenPlugin   (could easily be split out as a separate file/class, but included for ease of use (so that people don't need to include another script call before loading plugins which is easy to forget)
 * ----------------------------------------------------------------
 */
		var TweenPlugin = _class("plugins.TweenPlugin", function(props, priority) {
					this._overwriteProps = (props || "").split(",");
					this._propName = this._overwriteProps[0];
					this._priority = priority || 0;
					this._super = TweenPlugin.prototype;
				}, true);

		p = TweenPlugin.prototype;
		TweenPlugin.version = "1.10.1";
		TweenPlugin.API = 2;
		p._firstPT = null;

		p._addTween = function(target, prop, start, end, overwriteProp, round) {
			var c, pt;
			if (end != null && (c = (typeof(end) === "number" || end.charAt(1) !== "=") ? Number(end) - start : parseInt(end.charAt(0) + "1", 10) * Number(end.substr(2)))) {
				this._firstPT = pt = {_next:this._firstPT, t:target, p:prop, s:start, c:c, f:(typeof(target[prop]) === "function"), n:overwriteProp || prop, r:round};
				if (pt._next) {
					pt._next._prev = pt;
				}
				return pt;
			}
		};

		p.setRatio = function(v) {
			var pt = this._firstPT,
				min = 0.000001,
				val;
			while (pt) {
				val = pt.c * v + pt.s;
				if (pt.r) {
					val = Math.round(val);
				} else if (val < min) if (val > -min) { //prevents issues with converting very small numbers to strings in the browser
					val = 0;
				}
				if (pt.f) {
					pt.t[pt.p](val);
				} else {
					pt.t[pt.p] = val;
				}
				pt = pt._next;
			}
		};

		p._kill = function(lookup) {
			var a = this._overwriteProps,
				pt = this._firstPT,
				i;
			if (lookup[this._propName] != null) {
				this._overwriteProps = [];
			} else {
				i = a.length;
				while (--i > -1) {
					if (lookup[a[i]] != null) {
						a.splice(i, 1);
					}
				}
			}
			while (pt) {
				if (lookup[pt.n] != null) {
					if (pt._next) {
						pt._next._prev = pt._prev;
					}
					if (pt._prev) {
						pt._prev._next = pt._next;
						pt._prev = null;
					} else if (this._firstPT === pt) {
						this._firstPT = pt._next;
					}
				}
				pt = pt._next;
			}
			return false;
		};

		p._roundProps = function(lookup, value) {
			var pt = this._firstPT;
			while (pt) {
				if (lookup[this._propName] || (pt.n != null && lookup[ pt.n.split(this._propName + "_").join("") ])) { //some properties that are very plugin-specific add a prefix named after the _propName plus an underscore, so we need to ignore that extra stuff here.
					pt.r = value;
				}
				pt = pt._next;
			}
		};

		TweenLite._onPluginEvent = function(type, tween) {
			var pt = tween._firstPT,
				changed, pt2, first, last, next;
			if (type === "_onInitAllProps") {
				//sorts the PropTween linked list in order of priority because some plugins need to render earlier/later than others, like MotionBlurPlugin applies its effects after all x/y/alpha tweens have rendered on each frame.
				while (pt) {
					next = pt._next;
					pt2 = first;
					while (pt2 && pt2.pr > pt.pr) {
						pt2 = pt2._next;
					}
					if ((pt._prev = pt2 ? pt2._prev : last)) {
						pt._prev._next = pt;
					} else {
						first = pt;
					}
					if ((pt._next = pt2)) {
						pt2._prev = pt;
					} else {
						last = pt;
					}
					pt = next;
				}
				pt = tween._firstPT = first;
			}
			while (pt) {
				if (pt.pg) if (typeof(pt.t[type]) === "function") if (pt.t[type]()) {
					changed = true;
				}
				pt = pt._next;
			}
			return changed;
		};

		TweenPlugin.activate = function(plugins) {
			var i = plugins.length;
			while (--i > -1) {
				if (plugins[i].API === TweenPlugin.API) {
					_plugins[(new plugins[i]())._propName] = plugins[i];
				}
			}
			return true;
		};

		//provides a more concise way to define plugins that have no dependencies besides TweenPlugin and TweenLite, wrapping common boilerplate stuff into one function (added in 1.9.0). You don't NEED to use this to define a plugin - the old way still works and can be useful in certain (rare) situations.
		_gsDefine.plugin = function(config) {
			if (!config || !config.propName || !config.init || !config.API) { throw "illegal plugin definition."; }
			var propName = config.propName,
				priority = config.priority || 0,
				overwriteProps = config.overwriteProps,
				map = {init:"_onInitTween", set:"setRatio", kill:"_kill", round:"_roundProps", initAll:"_onInitAllProps"},
				Plugin = _class("plugins." + propName.charAt(0).toUpperCase() + propName.substr(1) + "Plugin",
					function() {
						TweenPlugin.call(this, propName, priority);
						this._overwriteProps = overwriteProps || [];
					}, (config.global === true)),
				p = Plugin.prototype = new TweenPlugin(propName),
				prop;
			p.constructor = Plugin;
			Plugin.API = config.API;
			for (prop in map) {
				if (typeof(config[prop]) === "function") {
					p[map[prop]] = config[prop];
				}
			}
			Plugin.version = config.version;
			TweenPlugin.activate([Plugin]);
			return Plugin;
		};


		//now run through all the dependencies discovered and if any are missing, log that to the console as a warning. This is why it's best to have TweenLite load last - it can check all the dependencies for you.
		a = window._gsQueue;
		if (a) {
			for (i = 0; i < a.length; i++) {
				a[i]();
			}
			for (p in _defLookup) {
				if (!_defLookup[p].func) {
					window.console.log("GSAP encountered missing dependency: com.greensock." + p);
				}
			}
		}

		_tickerActive = false; //ensures that the first official animation forces a ticker.tick() to update the time when it is instantiated

})((typeof(module) !== "undefined" && module.exports && typeof(global) !== "undefined") ? global : this || window, "TweenMax");
;(function(){

/**
 * Require the given path.
 *
 * @param {String} path
 * @return {Object} exports
 * @api public
 */

function require(path, parent, orig) {
  var resolved = require.resolve(path);

  // lookup failed
  if (null == resolved) {
    orig = orig || path;
    parent = parent || 'root';
    var err = new Error('Failed to require "' + orig + '" from "' + parent + '"');
    err.path = orig;
    err.parent = parent;
    err.require = true;
    throw err;
  }

  var module = require.modules[resolved];

  // perform real require()
  // by invoking the module's
  // registered function
  if (!module._resolving && !module.exports) {
    var mod = {};
    mod.exports = {};
    mod.client = mod.component = true;
    module._resolving = true;
    module.call(this, mod.exports, require.relative(resolved), mod);
    delete module._resolving;
    module.exports = mod.exports;
  }

  return module.exports;
}

/**
 * Registered modules.
 */

require.modules = {};

/**
 * Registered aliases.
 */

require.aliases = {};

/**
 * Resolve `path`.
 *
 * Lookup:
 *
 *   - PATH/index.js
 *   - PATH.js
 *   - PATH
 *
 * @param {String} path
 * @return {String} path or null
 * @api private
 */

require.resolve = function(path) {
  if (path.charAt(0) === '/') path = path.slice(1);

  var paths = [
    path,
    path + '.js',
    path + '.json',
    path + '/index.js',
    path + '/index.json'
  ];

  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    if (require.modules.hasOwnProperty(path)) return path;
    if (require.aliases.hasOwnProperty(path)) return require.aliases[path];
  }
};

/**
 * Normalize `path` relative to the current path.
 *
 * @param {String} curr
 * @param {String} path
 * @return {String}
 * @api private
 */

require.normalize = function(curr, path) {
  var segs = [];

  if ('.' != path.charAt(0)) return path;

  curr = curr.split('/');
  path = path.split('/');

  for (var i = 0; i < path.length; ++i) {
    if ('..' == path[i]) {
      curr.pop();
    } else if ('.' != path[i] && '' != path[i]) {
      segs.push(path[i]);
    }
  }

  return curr.concat(segs).join('/');
};

/**
 * Register module at `path` with callback `definition`.
 *
 * @param {String} path
 * @param {Function} definition
 * @api private
 */

require.register = function(path, definition) {
  require.modules[path] = definition;
};

/**
 * Alias a module definition.
 *
 * @param {String} from
 * @param {String} to
 * @api private
 */

require.alias = function(from, to) {
  if (!require.modules.hasOwnProperty(from)) {
    throw new Error('Failed to alias "' + from + '", it does not exist');
  }
  require.aliases[to] = from;
};

/**
 * Return a require function relative to the `parent` path.
 *
 * @param {String} parent
 * @return {Function}
 * @api private
 */

require.relative = function(parent) {
  var p = require.normalize(parent, '..');

  /**
   * lastIndexOf helper.
   */

  function lastIndexOf(arr, obj) {
    var i = arr.length;
    while (i--) {
      if (arr[i] === obj) return i;
    }
    return -1;
  }

  /**
   * The relative require() itself.
   */

  function localRequire(path) {
    var resolved = localRequire.resolve(path);
    return require(resolved, parent, path);
  }

  /**
   * Resolve relative to the parent.
   */

  localRequire.resolve = function(path) {
    var c = path.charAt(0);
    if ('/' == c) return path.slice(1);
    if ('.' == c) return require.normalize(p, path);

    // resolve deps by returning
    // the dep in the nearest "deps"
    // directory
    var segs = parent.split('/');
    var i = lastIndexOf(segs, 'deps') + 1;
    if (!i) i = 0;
    path = segs.slice(0, i + 1).join('/') + '/deps/' + path;
    return path;
  };

  /**
   * Check if module is defined at `path`.
   */

  localRequire.exists = function(path) {
    return require.modules.hasOwnProperty(localRequire.resolve(path));
  };

  return localRequire;
};
require.register("component-indexof/index.js", function(exports, require, module){
module.exports = function(arr, obj){
  if (arr.indexOf) return arr.indexOf(obj);
  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] === obj) return i;
  }
  return -1;
};
});
require.register("component-classes/index.js", function(exports, require, module){
/**
 * Module dependencies.
 */

var index = require('indexof');

/**
 * Whitespace regexp.
 */

var re = /\s+/;

/**
 * toString reference.
 */

var toString = Object.prototype.toString;

/**
 * Wrap `el` in a `ClassList`.
 *
 * @param {Element} el
 * @return {ClassList}
 * @api public
 */

module.exports = function(el){
  return new ClassList(el);
};

/**
 * Initialize a new ClassList for `el`.
 *
 * @param {Element} el
 * @api private
 */

function ClassList(el) {
  if (!el) throw new Error('A DOM element reference is required');
  this.el = el;
  this.list = el.classList;
}

/**
 * Add class `name` if not already present.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.add = function(name){
  // classList
  if (this.list) {
    this.list.add(name);
    return this;
  }

  // fallback
  var arr = this.array();
  var i = index(arr, name);
  if (!~i) arr.push(name);
  this.el.className = arr.join(' ');
  return this;
};

/**
 * Remove class `name` when present, or
 * pass a regular expression to remove
 * any which match.
 *
 * @param {String|RegExp} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.remove = function(name){
  if ('[object RegExp]' == toString.call(name)) {
    return this.removeMatching(name);
  }

  // classList
  if (this.list) {
    this.list.remove(name);
    return this;
  }

  // fallback
  var arr = this.array();
  var i = index(arr, name);
  if (~i) arr.splice(i, 1);
  this.el.className = arr.join(' ');
  return this;
};

/**
 * Remove all classes matching `re`.
 *
 * @param {RegExp} re
 * @return {ClassList}
 * @api private
 */

ClassList.prototype.removeMatching = function(re){
  var arr = this.array();
  for (var i = 0; i < arr.length; i++) {
    if (re.test(arr[i])) {
      this.remove(arr[i]);
    }
  }
  return this;
};

/**
 * Toggle class `name`.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.toggle = function(name){
  // classList
  if (this.list) {
    this.list.toggle(name);
    return this;
  }

  // fallback
  if (this.has(name)) {
    this.remove(name);
  } else {
    this.add(name);
  }
  return this;
};

/**
 * Return an array of classes.
 *
 * @return {Array}
 * @api public
 */

ClassList.prototype.array = function(){
  var str = this.el.className.replace(/^\s+|\s+$/g, '');
  var arr = str.split(re);
  if ('' === arr[0]) arr.shift();
  return arr;
};

/**
 * Check if class `name` is present.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.has =
ClassList.prototype.contains = function(name){
  return this.list
    ? this.list.contains(name)
    : !! ~index(this.array(), name);
};

});
require.register("segmentio-extend/index.js", function(exports, require, module){

module.exports = function extend (object) {
    // Takes an unlimited number of extenders.
    var args = Array.prototype.slice.call(arguments, 1);

    // For each extender, copy their properties on our object.
    for (var i = 0, source; source = args[i]; i++) {
        if (!source) continue;
        for (var property in source) {
            object[property] = source[property];
        }
    }

    return object;
};
});
require.register("component-event/index.js", function(exports, require, module){
var bind = (window.addEventListener !== undefined) ? 'addEventListener' : 'attachEvent',
    unbind = (window.removeEventListener !== undefined) ? 'removeEventListener' : 'detachEvent',
    prefix = (bind !== 'addEventListener') ? 'on' : '';

/**
 * Bind `el` event `type` to `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.bind = function(el, type, fn, capture){
  el[bind](prefix + type, fn, capture || false);

  return fn;
};

/**
 * Unbind `el` event `type`'s callback `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.unbind = function(el, type, fn, capture){
  el[unbind](prefix + type, fn, capture || false);

  return fn;
};
});
require.register("component-type/index.js", function(exports, require, module){

/**
 * toString ref.
 */

var toString = Object.prototype.toString;

/**
 * Return the type of `val`.
 *
 * @param {Mixed} val
 * @return {String}
 * @api public
 */

module.exports = function(val){
  switch (toString.call(val)) {
    case '[object Function]': return 'function';
    case '[object Date]': return 'date';
    case '[object RegExp]': return 'regexp';
    case '[object Arguments]': return 'arguments';
    case '[object Array]': return 'array';
    case '[object String]': return 'string';
  }

  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (val && val.nodeType === 1) return 'element';
  if (val === Object(val)) return 'object';

  return typeof val;
};

});
require.register("timoxley-is-collection/index.js", function(exports, require, module){
var typeOf = require('type')

/**
 * Evaluates _obj_ to determine if it's an array, an array-like collection, or
 * something else. This is useful when working with the function `arguments`
 * collection and `HTMLElement` collections.
 * Note: This implementation doesn't consider elements that are also
 *
 *
  
  collections, such as `<form>` and `<select>`, to be array-like.

  @method test
@param {Object} obj Object to test.
@return {Number} A number indicating the results of the test:

 * 0: Neither an array nor an array-like collection.
 * 1: Real array.
 * 2: Array-like collection.

@api private
 **/
module.exports = function isCollection(obj) {
  var type = typeOf(obj)
  if (type === 'array') return 1
    switch (type) {
      case 'arguments': return 2
      case 'object':
        if (isNodeList(obj)) return 2
        try {
          // indexed, but no tagName (element) or scrollTo/document (window. From DOM.isWindow test which we can't use here),
          // or functions without apply/call (Safari
          // HTMLElementCollection bug).
          if ('length' in obj
              && !obj.tagName
            && !(obj.scrollTo && obj.document)
            && !obj.apply) {
              return 2
            }
        } catch (ex) {}
      default:
        return 0
    }
}

function isNodeList(nodes) {
  return typeof nodes === 'object'
  && /^\[object (NodeList)\]$/.test(Object.prototype.toString.call(nodes))
  && nodes.hasOwnProperty('length')
  && (nodes.length == 0 || (typeof nodes[0] === "object" && nodes[0].nodeType > 0))
}


});
require.register("javve-events/index.js", function(exports, require, module){
var events = require('event'),
  isCollection = require('is-collection');

/**
 * Bind `el` event `type` to `fn`.
 *
 * @param {Element} el, NodeList, HTMLCollection or Array
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @api public
 */

exports.bind = function(el, type, fn, capture){
  if (!isCollection(el)) {
    events.bind(el, type, fn, capture);
  } else if ( el && el[0] !== undefined ) {
    for ( var i = 0; i < el.length; i++ ) {
      events.bind(el[i], type, fn, capture);
    }
  }
};

/**
 * Unbind `el` event `type`'s callback `fn`.
 *
 * @param {Element} el, NodeList, HTMLCollection or Array
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @api public
 */

exports.unbind = function(el, type, fn, capture){
  if (!isCollection(el)) {
    events.unbind(el, type, fn, capture);
  } else if ( el && el[0] !== undefined ) {
    for ( var i = 0; i < el.length; i++ ) {
      events.unbind(el[i], type, fn, capture);
    }
  }
};
});
require.register("javve-get-by-class/index.js", function(exports, require, module){
/**
 * Find all elements with class `className` inside `container`.
 * Use `single = true` to increase performance in older browsers
 * when only one element is needed.
 *
 * @param {String} className
 * @param {Element} container
 * @param {Boolean} single
 * @api public
 */

module.exports = (function() {
  if (document.getElementsByClassName) {
    return function(container, className, single) {
      if (single) {
        return container.getElementsByClassName(className)[0];
      } else {
        return container.getElementsByClassName(className);
      }
    };
  } else if (document.querySelector) {
    return function(container, className, single) {
      if (single) {
        return container.querySelector(className);
      } else {
        return container.querySelectorAll(className);
      }
    };
  } else {
    return function(container, className, single) {
      var classElements = [],
        tag = '*';
      if (container == null) {
        container = document;
      }
      var els = container.getElementsByTagName(tag);
      var elsLen = els.length;
      var pattern = new RegExp("(^|\\s)"+className+"(\\s|$)");
      for (var i = 0, j = 0; i < elsLen; i++) {
        if ( pattern.test(els[i].className) ) {
          if (single) {
            return els[i];
          } else {
            classElements[j] = els[i];
            j++;
          }
        }
      }
      return classElements;
    };
  }
})();

});
require.register("javve-to-string/index.js", function(exports, require, module){
module.exports = function(s) {
    s = (s === undefined) ? "" : s;
    s = (s === null) ? "" : s;
    s = s.toString();
    return s;
};

});
require.register("list.fuzzysearch.js/index.js", function(exports, require, module){
var classes = require('classes'),
    events = require('events'),
    extend = require('extend'),
    toString = require('to-string'),
    getByClass = require('get-by-class');

module.exports = function(options) {
    options = options || {};

    extend(options, {
        location: 0,
        distance: 100,
        threshold: 0.4,
        multiSearch: true,
        searchClass: 'fuzzy-search'
    });

    var fuzzy = require('./src/fuzzy'),
        list;

    var fuzzySearch = {
        search: function(searchString, columns) {
            // Substract arguments from the searchString or put searchString as only argument
            var searchArguments = options.multiSearch ? searchString.replace(/ +$/, '').split(/ +/) : [searchString];

            for (var k = 0, kl = list.items.length; k < kl; k++) {
                fuzzySearch.item(list.items[k], columns, searchArguments);
            }
        },
        item: function(item, columns, searchArguments) {
            var found = true;
            for(var i = 0; i < searchArguments.length; i++) {
                var foundArgument = false;
                for (var j = 0, jl = columns.length; j < jl; j++) {
                    if (fuzzySearch.values(item.values(), columns[j], searchArguments[i])) {
                        foundArgument = true;
                    }
                }
                if(!foundArgument) {
                    found = false;
                }
            }
            item.found = found;
        },
        values: function(values, value, searchArgument) {
            if (values.hasOwnProperty(value)) {
                var text = toString(values[value]).toLowerCase();

                if (fuzzy(text, searchArgument, options)) {
                    return true;
                }
            }
            return false;
        }
    };

    return {
        init: function(parentList) {
            list = parentList;

            events.bind(getByClass(list.listContainer, options.searchClass), 'keyup', function(e) {
                var target = e.target || e.srcElement; // IE have srcElement
                list.search(target.value, fuzzySearch.search);
            });

            return;
        },
        search: function(str, columns) {
            list.search(str, columns, fuzzySearch.search);
        },
        name: options.name || "fuzzySearch"
    };
};

});
require.register("list.fuzzysearch.js/src/fuzzy.js", function(exports, require, module){
module.exports = function(text, pattern, options) {
    // Aproximately where in the text is the pattern expected to be found?
    var Match_Location = options.location || 0;

    //Determines how close the match must be to the fuzzy location (specified above). An exact letter match which is 'distance' characters away from the fuzzy location would score as a complete mismatch. A distance of '0' requires the match be at the exact location specified, a threshold of '1000' would require a perfect match to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
    var Match_Distance = options.distance || 100;

    // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match (of both letters and location), a threshold of '1.0' would match anything.
    var Match_Threshold = options.threshold || 0.4;

    if (pattern === text) return true; // Exact match
    if (pattern.length > 32) return false; // This algorithm cannot be used

    // Set starting location at beginning text and initialise the alphabet.
    var loc = Match_Location,
        s = (function() {
            var q = {},
                i;

            for (i = 0; i < pattern.length; i++) {
                q[pattern.charAt(i)] = 0;
            }

            for (i = 0; i < pattern.length; i++) {
                q[pattern.charAt(i)] |= 1 << (pattern.length - i - 1);
            }

            return q;
        }());

    // Compute and return the score for a match with e errors and x location.
    // Accesses loc and pattern through being a closure.

    function match_bitapScore_(e, x) {
        var accuracy = e / pattern.length,
            proximity = Math.abs(loc - x);

        if (!Match_Distance) {
            // Dodge divide by zero error.
            return proximity ? 1.0 : accuracy;
        }
        return accuracy + (proximity / Match_Distance);
    }

    var score_threshold = Match_Threshold, // Highest score beyond which we give up.
        best_loc = text.indexOf(pattern, loc); // Is there a nearby exact match? (speedup)

    if (best_loc != -1) {
        score_threshold = Math.min(match_bitapScore_(0, best_loc), score_threshold);
        // What about in the other direction? (speedup)
        best_loc = text.lastIndexOf(pattern, loc + pattern.length);

        if (best_loc != -1) {
            score_threshold = Math.min(match_bitapScore_(0, best_loc), score_threshold);
        }
    }

    // Initialise the bit arrays.
    var matchmask = 1 << (pattern.length - 1);
    best_loc = -1;

    var bin_min, bin_mid;
    var bin_max = pattern.length + text.length;
    var last_rd;
    for (var d = 0; d < pattern.length; d++) {
        // Scan for the best match; each iteration allows for one more error.
        // Run a binary search to determine how far from 'loc' we can stray at this
        // error level.
        bin_min = 0;
        bin_mid = bin_max;
        while (bin_min < bin_mid) {
            if (match_bitapScore_(d, loc + bin_mid) <= score_threshold) {
                bin_min = bin_mid;
            } else {
                bin_max = bin_mid;
            }
            bin_mid = Math.floor((bin_max - bin_min) / 2 + bin_min);
        }
        // Use the result from this iteration as the maximum for the next.
        bin_max = bin_mid;
        var start = Math.max(1, loc - bin_mid + 1);
        var finish = Math.min(loc + bin_mid, text.length) + pattern.length;

        var rd = Array(finish + 2);
        rd[finish + 1] = (1 << d) - 1;
        for (var j = finish; j >= start; j--) {
            // The alphabet (s) is a sparse hash, so the following line generates
            // warnings.
            var charMatch = s[text.charAt(j - 1)];
            if (d === 0) {    // First pass: exact match.
                rd[j] = ((rd[j + 1] << 1) | 1) & charMatch;
            } else {    // Subsequent passes: fuzzy match.
                rd[j] = (((rd[j + 1] << 1) | 1) & charMatch) |
                                (((last_rd[j + 1] | last_rd[j]) << 1) | 1) |
                                last_rd[j + 1];
            }
            if (rd[j] & matchmask) {
                var score = match_bitapScore_(d, j - 1);
                // This match will almost certainly be better than any existing match.
                // But check anyway.
                if (score <= score_threshold) {
                    // Told you so.
                    score_threshold = score;
                    best_loc = j - 1;
                    if (best_loc > loc) {
                        // When passing loc, don't exceed our current distance from loc.
                        start = Math.max(1, 2 * loc - best_loc);
                    } else {
                        // Already passed loc, downhill from here on in.
                        break;
                    }
                }
            }
        }
        // No hope for a (better) match at greater error levels.
        if (match_bitapScore_(d + 1, loc) > score_threshold) {
            break;
        }
        last_rd = rd;
    }

    return (best_loc < 0) ? false : true;
};

});






require.alias("component-classes/index.js", "list.fuzzysearch.js/deps/classes/index.js");
require.alias("component-classes/index.js", "classes/index.js");
require.alias("component-indexof/index.js", "component-classes/deps/indexof/index.js");

require.alias("segmentio-extend/index.js", "list.fuzzysearch.js/deps/extend/index.js");
require.alias("segmentio-extend/index.js", "extend/index.js");

require.alias("javve-events/index.js", "list.fuzzysearch.js/deps/events/index.js");
require.alias("javve-events/index.js", "events/index.js");
require.alias("component-event/index.js", "javve-events/deps/event/index.js");

require.alias("timoxley-is-collection/index.js", "javve-events/deps/is-collection/index.js");
require.alias("component-type/index.js", "timoxley-is-collection/deps/type/index.js");

require.alias("javve-get-by-class/index.js", "list.fuzzysearch.js/deps/get-by-class/index.js");
require.alias("javve-get-by-class/index.js", "get-by-class/index.js");

require.alias("javve-to-string/index.js", "list.fuzzysearch.js/deps/to-string/index.js");
require.alias("javve-to-string/index.js", "list.fuzzysearch.js/deps/to-string/index.js");
require.alias("javve-to-string/index.js", "to-string/index.js");
require.alias("javve-to-string/index.js", "javve-to-string/index.js");
require.alias("list.fuzzysearch.js/index.js", "list.fuzzysearch.js/index.js");if (typeof exports == "object") {
  module.exports = require("list.fuzzysearch.js");
} else if (typeof define == "function" && define.amd) {
  define(function(){ return require("list.fuzzysearch.js"); });
} else {
  this["ListFuzzySearch"] = require("list.fuzzysearch.js");
}})();
;(function(){

/**
 * Require the given path.
 *
 * @param {String} path
 * @return {Object} exports
 * @api public
 */

function require(path, parent, orig) {
  var resolved = require.resolve(path);

  // lookup failed
  if (null == resolved) {
    orig = orig || path;
    parent = parent || 'root';
    var err = new Error('Failed to require "' + orig + '" from "' + parent + '"');
    err.path = orig;
    err.parent = parent;
    err.require = true;
    throw err;
  }

  var module = require.modules[resolved];

  // perform real require()
  // by invoking the module's
  // registered function
  if (!module._resolving && !module.exports) {
    var mod = {};
    mod.exports = {};
    mod.client = mod.component = true;
    module._resolving = true;
    module.call(this, mod.exports, require.relative(resolved), mod);
    delete module._resolving;
    module.exports = mod.exports;
  }

  return module.exports;
}

/**
 * Registered modules.
 */

require.modules = {};

/**
 * Registered aliases.
 */

require.aliases = {};

/**
 * Resolve `path`.
 *
 * Lookup:
 *
 *   - PATH/index.js
 *   - PATH.js
 *   - PATH
 *
 * @param {String} path
 * @return {String} path or null
 * @api private
 */

require.resolve = function(path) {
  if (path.charAt(0) === '/') path = path.slice(1);

  var paths = [
    path,
    path + '.js',
    path + '.json',
    path + '/index.js',
    path + '/index.json'
  ];

  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    if (require.modules.hasOwnProperty(path)) return path;
    if (require.aliases.hasOwnProperty(path)) return require.aliases[path];
  }
};

/**
 * Normalize `path` relative to the current path.
 *
 * @param {String} curr
 * @param {String} path
 * @return {String}
 * @api private
 */

require.normalize = function(curr, path) {
  var segs = [];

  if ('.' != path.charAt(0)) return path;

  curr = curr.split('/');
  path = path.split('/');

  for (var i = 0; i < path.length; ++i) {
    if ('..' == path[i]) {
      curr.pop();
    } else if ('.' != path[i] && '' != path[i]) {
      segs.push(path[i]);
    }
  }

  return curr.concat(segs).join('/');
};

/**
 * Register module at `path` with callback `definition`.
 *
 * @param {String} path
 * @param {Function} definition
 * @api private
 */

require.register = function(path, definition) {
  require.modules[path] = definition;
};

/**
 * Alias a module definition.
 *
 * @param {String} from
 * @param {String} to
 * @api private
 */

require.alias = function(from, to) {
  if (!require.modules.hasOwnProperty(from)) {
    throw new Error('Failed to alias "' + from + '", it does not exist');
  }
  require.aliases[to] = from;
};

/**
 * Return a require function relative to the `parent` path.
 *
 * @param {String} parent
 * @return {Function}
 * @api private
 */

require.relative = function(parent) {
  var p = require.normalize(parent, '..');

  /**
   * lastIndexOf helper.
   */

  function lastIndexOf(arr, obj) {
    var i = arr.length;
    while (i--) {
      if (arr[i] === obj) return i;
    }
    return -1;
  }

  /**
   * The relative require() itself.
   */

  function localRequire(path) {
    var resolved = localRequire.resolve(path);
    return require(resolved, parent, path);
  }

  /**
   * Resolve relative to the parent.
   */

  localRequire.resolve = function(path) {
    var c = path.charAt(0);
    if ('/' == c) return path.slice(1);
    if ('.' == c) return require.normalize(p, path);

    // resolve deps by returning
    // the dep in the nearest "deps"
    // directory
    var segs = parent.split('/');
    var i = lastIndexOf(segs, 'deps') + 1;
    if (!i) i = 0;
    path = segs.slice(0, i + 1).join('/') + '/deps/' + path;
    return path;
  };

  /**
   * Check if module is defined at `path`.
   */

  localRequire.exists = function(path) {
    return require.modules.hasOwnProperty(localRequire.resolve(path));
  };

  return localRequire;
};
require.register("component-classes/index.js", function(exports, require, module){
/**
 * Module dependencies.
 */

var index = require('indexof');

/**
 * Whitespace regexp.
 */

var re = /\s+/;

/**
 * toString reference.
 */

var toString = Object.prototype.toString;

/**
 * Wrap `el` in a `ClassList`.
 *
 * @param {Element} el
 * @return {ClassList}
 * @api public
 */

module.exports = function(el){
  return new ClassList(el);
};

/**
 * Initialize a new ClassList for `el`.
 *
 * @param {Element} el
 * @api private
 */

function ClassList(el) {
  if (!el) throw new Error('A DOM element reference is required');
  this.el = el;
  this.list = el.classList;
}

/**
 * Add class `name` if not already present.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.add = function(name){
  // classList
  if (this.list) {
    this.list.add(name);
    return this;
  }

  // fallback
  var arr = this.array();
  var i = index(arr, name);
  if (!~i) arr.push(name);
  this.el.className = arr.join(' ');
  return this;
};

/**
 * Remove class `name` when present, or
 * pass a regular expression to remove
 * any which match.
 *
 * @param {String|RegExp} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.remove = function(name){
  if ('[object RegExp]' == toString.call(name)) {
    return this.removeMatching(name);
  }

  // classList
  if (this.list) {
    this.list.remove(name);
    return this;
  }

  // fallback
  var arr = this.array();
  var i = index(arr, name);
  if (~i) arr.splice(i, 1);
  this.el.className = arr.join(' ');
  return this;
};

/**
 * Remove all classes matching `re`.
 *
 * @param {RegExp} re
 * @return {ClassList}
 * @api private
 */

ClassList.prototype.removeMatching = function(re){
  var arr = this.array();
  for (var i = 0; i < arr.length; i++) {
    if (re.test(arr[i])) {
      this.remove(arr[i]);
    }
  }
  return this;
};

/**
 * Toggle class `name`, can force state via `force`.
 *
 * For browsers that support classList, but do not support `force` yet,
 * the mistake will be detected and corrected.
 *
 * @param {String} name
 * @param {Boolean} force
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.toggle = function(name, force){
  // classList
  if (this.list) {
    if ("undefined" !== typeof force) {
      if (force !== this.list.toggle(name, force)) {
        this.list.toggle(name); // toggle again to correct
      }
    } else {
      this.list.toggle(name);
    }
    return this;
  }

  // fallback
  if ("undefined" !== typeof force) {
    if (!force) {
      this.remove(name);
    } else {
      this.add(name);
    }
  } else {
    if (this.has(name)) {
      this.remove(name);
    } else {
      this.add(name);
    }
  }

  return this;
};

/**
 * Return an array of classes.
 *
 * @return {Array}
 * @api public
 */

ClassList.prototype.array = function(){
  var str = this.el.className.replace(/^\s+|\s+$/g, '');
  var arr = str.split(re);
  if ('' === arr[0]) arr.shift();
  return arr;
};

/**
 * Check if class `name` is present.
 *
 * @param {String} name
 * @return {ClassList}
 * @api public
 */

ClassList.prototype.has =
ClassList.prototype.contains = function(name){
  return this.list
    ? this.list.contains(name)
    : !! ~index(this.array(), name);
};

});
require.register("segmentio-extend/index.js", function(exports, require, module){

module.exports = function extend (object) {
    // Takes an unlimited number of extenders.
    var args = Array.prototype.slice.call(arguments, 1);

    // For each extender, copy their properties on our object.
    for (var i = 0, source; source = args[i]; i++) {
        if (!source) continue;
        for (var property in source) {
            object[property] = source[property];
        }
    }

    return object;
};
});
require.register("component-indexof/index.js", function(exports, require, module){
module.exports = function(arr, obj){
  if (arr.indexOf) return arr.indexOf(obj);
  for (var i = 0; i < arr.length; ++i) {
    if (arr[i] === obj) return i;
  }
  return -1;
};
});
require.register("component-event/index.js", function(exports, require, module){
var bind = window.addEventListener ? 'addEventListener' : 'attachEvent',
    unbind = window.removeEventListener ? 'removeEventListener' : 'detachEvent',
    prefix = bind !== 'addEventListener' ? 'on' : '';

/**
 * Bind `el` event `type` to `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.bind = function(el, type, fn, capture){
  el[bind](prefix + type, fn, capture || false);
  return fn;
};

/**
 * Unbind `el` event `type`'s callback `fn`.
 *
 * @param {Element} el
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @return {Function}
 * @api public
 */

exports.unbind = function(el, type, fn, capture){
  el[unbind](prefix + type, fn, capture || false);
  return fn;
};
});
require.register("timoxley-to-array/index.js", function(exports, require, module){
/**
 * Convert an array-like object into an `Array`.
 * If `collection` is already an `Array`, then will return a clone of `collection`.
 *
 * @param {Array | Mixed} collection An `Array` or array-like object to convert e.g. `arguments` or `NodeList`
 * @return {Array} Naive conversion of `collection` to a new `Array`.
 * @api public
 */

module.exports = function toArray(collection) {
  if (typeof collection === 'undefined') return []
  if (collection === null) return [null]
  if (collection === window) return [window]
  if (typeof collection === 'string') return [collection]
  if (isArray(collection)) return collection
  if (typeof collection.length != 'number') return [collection]
  if (typeof collection === 'function' && collection instanceof Function) return [collection]

  var arr = []
  for (var i = 0; i < collection.length; i++) {
    if (Object.prototype.hasOwnProperty.call(collection, i) || i in collection) {
      arr.push(collection[i])
    }
  }
  if (!arr.length) return []
  return arr
}

function isArray(arr) {
  return Object.prototype.toString.call(arr) === "[object Array]";
}

});
require.register("javve-events/index.js", function(exports, require, module){
var events = require('event'),
  toArray = require('to-array');

/**
 * Bind `el` event `type` to `fn`.
 *
 * @param {Element} el, NodeList, HTMLCollection or Array
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @api public
 */

exports.bind = function(el, type, fn, capture){
  el = toArray(el);
  for ( var i = 0; i < el.length; i++ ) {
    events.bind(el[i], type, fn, capture);
  }
};

/**
 * Unbind `el` event `type`'s callback `fn`.
 *
 * @param {Element} el, NodeList, HTMLCollection or Array
 * @param {String} type
 * @param {Function} fn
 * @param {Boolean} capture
 * @api public
 */

exports.unbind = function(el, type, fn, capture){
  el = toArray(el);
  for ( var i = 0; i < el.length; i++ ) {
    events.unbind(el[i], type, fn, capture);
  }
};

});
require.register("javve-get-by-class/index.js", function(exports, require, module){
/**
 * Find all elements with class `className` inside `container`.
 * Use `single = true` to increase performance in older browsers
 * when only one element is needed.
 *
 * @param {String} className
 * @param {Element} container
 * @param {Boolean} single
 * @api public
 */

module.exports = (function() {
  if (document.getElementsByClassName) {
    return function(container, className, single) {
      if (single) {
        return container.getElementsByClassName(className)[0];
      } else {
        return container.getElementsByClassName(className);
      }
    };
  } else if (document.querySelector) {
    return function(container, className, single) {
      className = '.' + className;
      if (single) {
        return container.querySelector(className);
      } else {
        return container.querySelectorAll(className);
      }
    };
  } else {
    return function(container, className, single) {
      var classElements = [],
        tag = '*';
      if (container == null) {
        container = document;
      }
      var els = container.getElementsByTagName(tag);
      var elsLen = els.length;
      var pattern = new RegExp("(^|\\s)"+className+"(\\s|$)");
      for (var i = 0, j = 0; i < elsLen; i++) {
        if ( pattern.test(els[i].className) ) {
          if (single) {
            return els[i];
          } else {
            classElements[j] = els[i];
            j++;
          }
        }
      }
      return classElements;
    };
  }
})();

});
require.register("javve-get-attribute/index.js", function(exports, require, module){
/**
 * Return the value for `attr` at `element`.
 *
 * @param {Element} el
 * @param {String} attr
 * @api public
 */

module.exports = function(el, attr) {
  var result = (el.getAttribute && el.getAttribute(attr)) || null;
  if( !result ) {
    var attrs = el.attributes;
    var length = attrs.length;
    for(var i = 0; i < length; i++) {
      if (attr[i] !== undefined) {
        if(attr[i].nodeName === attr) {
          result = attr[i].nodeValue;
        }
      }
    }
  }
  return result;
}
});
require.register("javve-natural-sort/index.js", function(exports, require, module){
/*
 * Natural Sort algorithm for Javascript - Version 0.7 - Released under MIT license
 * Author: Jim Palmer (based on chunking idea from Dave Koelle)
 */

module.exports = function(a, b, options) {
  var re = /(^-?[0-9]+(\.?[0-9]*)[df]?e?[0-9]?$|^0x[0-9a-f]+$|[0-9]+)/gi,
    sre = /(^[ ]*|[ ]*$)/g,
    dre = /(^([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?|^\d{1,4}[\/\-]\d{1,4}[\/\-]\d{1,4}|^\w+, \w+ \d+, \d{4})/,
    hre = /^0x[0-9a-f]+$/i,
    ore = /^0/,
    options = options || {},
    i = function(s) { return options.insensitive && (''+s).toLowerCase() || ''+s },
    // convert all to strings strip whitespace
    x = i(a).replace(sre, '') || '',
    y = i(b).replace(sre, '') || '',
    // chunk/tokenize
    xN = x.replace(re, '\0$1\0').replace(/\0$/,'').replace(/^\0/,'').split('\0'),
    yN = y.replace(re, '\0$1\0').replace(/\0$/,'').replace(/^\0/,'').split('\0'),
    // numeric, hex or date detection
    xD = parseInt(x.match(hre)) || (xN.length != 1 && x.match(dre) && Date.parse(x)),
    yD = parseInt(y.match(hre)) || xD && y.match(dre) && Date.parse(y) || null,
    oFxNcL, oFyNcL,
    mult = options.desc ? -1 : 1;
  // first try and sort Hex codes or Dates
  if (yD)
    if ( xD < yD ) return -1 * mult;
    else if ( xD > yD ) return 1 * mult;
  // natural sorting through split numeric strings and default strings
  for(var cLoc=0, numS=Math.max(xN.length, yN.length); cLoc < numS; cLoc++) {
    // find floats not starting with '0', string or 0 if not defined (Clint Priest)
    oFxNcL = !(xN[cLoc] || '').match(ore) && parseFloat(xN[cLoc]) || xN[cLoc] || 0;
    oFyNcL = !(yN[cLoc] || '').match(ore) && parseFloat(yN[cLoc]) || yN[cLoc] || 0;
    // handle numeric vs string comparison - number < string - (Kyle Adams)
    if (isNaN(oFxNcL) !== isNaN(oFyNcL)) { return (isNaN(oFxNcL)) ? 1 : -1; }
    // rely on string comparison if different types - i.e. '02' < 2 != '02' < '2'
    else if (typeof oFxNcL !== typeof oFyNcL) {
      oFxNcL += '';
      oFyNcL += '';
    }
    if (oFxNcL < oFyNcL) return -1 * mult;
    if (oFxNcL > oFyNcL) return 1 * mult;
  }
  return 0;
};

/*
var defaultSort = getSortFunction();

module.exports = function(a, b, options) {
  if (arguments.length == 1) {
    options = a;
    return getSortFunction(options);
  } else {
    return defaultSort(a,b);
  }
}
*/
});
require.register("javve-to-string/index.js", function(exports, require, module){
module.exports = function(s) {
    s = (s === undefined) ? "" : s;
    s = (s === null) ? "" : s;
    s = s.toString();
    return s;
};

});
require.register("component-type/index.js", function(exports, require, module){
/**
 * toString ref.
 */

var toString = Object.prototype.toString;

/**
 * Return the type of `val`.
 *
 * @param {Mixed} val
 * @return {String}
 * @api public
 */

module.exports = function(val){
  switch (toString.call(val)) {
    case '[object Date]': return 'date';
    case '[object RegExp]': return 'regexp';
    case '[object Arguments]': return 'arguments';
    case '[object Array]': return 'array';
    case '[object Error]': return 'error';
  }

  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (val !== val) return 'nan';
  if (val && val.nodeType === 1) return 'element';

  return typeof val.valueOf();
};

});
require.register("list.js/index.js", function(exports, require, module){
/*
ListJS with beta 1.0.0
By Jonny Strömberg (www.jonnystromberg.com, www.listjs.com)
*/
(function( window, undefined ) {
"use strict";

var document = window.document,
    getByClass = require('get-by-class'),
    extend = require('extend'),
    indexOf = require('indexof');

var List = function(id, options, values) {

    var self = this,
		init,
        Item = require('./src/item')(self),
        addAsync = require('./src/add-async')(self),
        parse = require('./src/parse')(self);

    init = {
        start: function() {
            self.listClass      = "list";
            self.searchClass    = "search";
            self.sortClass      = "sort";
            self.page           = 200;
            self.i              = 1;
            self.items          = [];
            self.visibleItems   = [];
            self.matchingItems  = [];
            self.searched       = false;
            self.filtered       = false;
            self.handlers       = { 'updated': [] };
            self.plugins        = {};
            self.helpers        = {
                getByClass: getByClass,
                extend: extend,
                indexOf: indexOf
            };

            extend(self, options);

            self.listContainer = (typeof(id) === 'string') ? document.getElementById(id) : id;
            if (!self.listContainer) { return; }
            self.list           = getByClass(self.listContainer, self.listClass, true);

            self.templater      = require('./src/templater')(self);
            self.search         = require('./src/search')(self);
            self.filter         = require('./src/filter')(self);
            self.sort           = require('./src/sort')(self);

            this.items();
            self.update();
            this.plugins();
        },
        items: function() {
            parse(self.list);
            if (values !== undefined) {
                self.add(values);
            }
        },
        plugins: function() {
            for (var i = 0; i < self.plugins.length; i++) {
                var plugin = self.plugins[i];
                self[plugin.name] = plugin;
                plugin.init(self);
            }
        }
    };


    /*
    * Add object to list
    */
    this.add = function(values, callback) {
        if (callback) {
            addAsync(values, callback);
            return;
        }
        var added = [],
            notCreate = false;
        if (values[0] === undefined){
            values = [values];
        }
        for (var i = 0, il = values.length; i < il; i++) {
            var item = null;
            if (values[i] instanceof Item) {
                item = values[i];
                item.reload();
            } else {
                notCreate = (self.items.length > self.page) ? true : false;
                item = new Item(values[i], undefined, notCreate);
            }
            self.items.push(item);
            added.push(item);
        }
        self.update();
        return added;
    };

	this.show = function(i, page) {
		this.i = i;
		this.page = page;
		self.update();
        return self;
	};

    /* Removes object from list.
    * Loops through the list and removes objects where
    * property "valuename" === value
    */
    this.remove = function(valueName, value, options) {
        var found = 0;
        for (var i = 0, il = self.items.length; i < il; i++) {
            if (self.items[i].values()[valueName] == value) {
                self.templater.remove(self.items[i], options);
                self.items.splice(i,1);
                il--;
                i--;
                found++;
            }
        }
        self.update();
        return found;
    };

    /* Gets the objects in the list which
    * property "valueName" === value
    */
    this.get = function(valueName, value) {
        var matchedItems = [];
        for (var i = 0, il = self.items.length; i < il; i++) {
            var item = self.items[i];
            if (item.values()[valueName] == value) {
                matchedItems.push(item);
            }
        }
        return matchedItems;
    };

    /*
    * Get size of the list
    */
    this.size = function() {
        return self.items.length;
    };

    /*
    * Removes all items from the list
    */
    this.clear = function() {
        self.templater.clear();
        self.items = [];
        return self;
    };

    this.on = function(event, callback) {
        self.handlers[event].push(callback);
        return self;
    };

    this.off = function(event, callback) {
        var e = self.handlers[event];
        var index = indexOf(e, callback);
        if (index > -1) {
            e.splice(index, 1);
        }
        return self;
    };

    this.trigger = function(event) {
        var i = self.handlers[event].length;
        while(i--) {
            self.handlers[event][i](self);
        }
        return self;
    };

    this.reset = {
        filter: function() {
            var is = self.items,
                il = is.length;
            while (il--) {
                is[il].filtered = false;
            }
            return self;
        },
        search: function() {
            var is = self.items,
                il = is.length;
            while (il--) {
                is[il].found = false;
            }
            return self;
        }
    };

    this.update = function() {
        var is = self.items,
			il = is.length;

        self.visibleItems = [];
        self.matchingItems = [];
        self.templater.clear();
        for (var i = 0; i < il; i++) {
            if (is[i].matching() && ((self.matchingItems.length+1) >= self.i && self.visibleItems.length < self.page)) {
                is[i].show();
                self.visibleItems.push(is[i]);
                self.matchingItems.push(is[i]);
			} else if (is[i].matching()) {
                self.matchingItems.push(is[i]);
                is[i].hide();
			} else {
                is[i].hide();
			}
        }
        self.trigger('updated');
        return self;
    };

    init.start();
};

module.exports = List;

})(window);

});
require.register("list.js/src/search.js", function(exports, require, module){
var events = require('events'),
    getByClass = require('get-by-class'),
    toString = require('to-string');

module.exports = function(list) {
    var item,
        text,
        columns,
        searchString,
        customSearch;

    var prepare = {
        resetList: function() {
            list.i = 1;
            list.templater.clear();
            customSearch = undefined;
        },
        setOptions: function(args) {
            if (args.length == 2 && args[1] instanceof Array) {
                columns = args[1];
            } else if (args.length == 2 && typeof(args[1]) == "function") {
                customSearch = args[1];
            } else if (args.length == 3) {
                columns = args[1];
                customSearch = args[2];
            }
        },
        setColumns: function() {
            columns = (columns === undefined) ? prepare.toArray(list.items[0].values()) : columns;
        },
        setSearchString: function(s) {
            s = toString(s).toLowerCase();
            s = s.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&"); // Escape regular expression characters
            searchString = s;
        },
        toArray: function(values) {
            var tmpColumn = [];
            for (var name in values) {
                tmpColumn.push(name);
            }
            return tmpColumn;
        }
    };
    var search = {
        list: function() {
            for (var k = 0, kl = list.items.length; k < kl; k++) {
                search.item(list.items[k]);
            }
        },
        item: function(item) {
            item.found = false;
            for (var j = 0, jl = columns.length; j < jl; j++) {
                if (search.values(item.values(), columns[j])) {
                    item.found = true;
                    return;
                }
            }
        },
        values: function(values, column) {
            if (values.hasOwnProperty(column)) {
                text = toString(values[column]).toLowerCase();
                if ((searchString !== "") && (text.search(searchString) > -1)) {
                    return true;
                }
            }
            return false;
        },
        reset: function() {
            list.reset.search();
            list.searched = false;
        }
    };

    var searchMethod = function(str) {
        list.trigger('searchStart');

        prepare.resetList();
        prepare.setSearchString(str);
        prepare.setOptions(arguments); // str, cols|searchFunction, searchFunction
        prepare.setColumns();

        if (searchString === "" ) {
            search.reset();
        } else {
            list.searched = true;
            if (customSearch) {
                customSearch(searchString, columns);
            } else {
                search.list();
            }
        }

        list.update();
        list.trigger('searchComplete');
        return list.visibleItems;
    };

    list.handlers.searchStart = list.handlers.searchStart || [];
    list.handlers.searchComplete = list.handlers.searchComplete || [];

    events.bind(getByClass(list.listContainer, list.searchClass), 'keyup', function(e) {
        var target = e.target || e.srcElement, // IE have srcElement
            alreadyCleared = (target.value === "" && !list.searched);
        if (!alreadyCleared) { // If oninput already have resetted the list, do nothing
            searchMethod(target.value);
        }
    });

    // Used to detect click on HTML5 clear button
    events.bind(getByClass(list.listContainer, list.searchClass), 'input', function(e) {
        var target = e.target || e.srcElement;
        if (target.value === "") {
            searchMethod('');
        }
    });

    list.helpers.toString = toString;
    return searchMethod;
};

});
require.register("list.js/src/sort.js", function(exports, require, module){
var naturalSort = require('natural-sort'),
    classes = require('classes'),
    events = require('events'),
    getByClass = require('get-by-class'),
    getAttribute = require('get-attribute');

module.exports = function(list) {
    list.sortFunction = list.sortFunction || function(itemA, itemB, options) {
        options.desc = options.order == "desc" ? true : false; // Natural sort uses this format
        return naturalSort(itemA.values()[options.valueName], itemB.values()[options.valueName], options);
    };

    var buttons = {
        els: undefined,
        clear: function() {
            for (var i = 0, il = buttons.els.length; i < il; i++) {
                classes(buttons.els[i]).remove('asc');
                classes(buttons.els[i]).remove('desc');
            }
        },
        getOrder: function(btn) {
            var predefinedOrder = getAttribute(btn, 'data-order');
            if (predefinedOrder == "asc" || predefinedOrder == "desc") {
                return predefinedOrder;
            } else if (classes(btn).has('desc')) {
                return "asc";
            } else if (classes(btn).has('asc')) {
                return "desc";
            } else {
                return "asc";
            }
        },
        getInSensitive: function(btn, options) {
            var insensitive = getAttribute(btn, 'data-insensitive');
            if (insensitive === "true") {
                options.insensitive = true;
            } else {
                options.insensitive = false;
            }
        },
        setOrder: function(options) {
            for (var i = 0, il = buttons.els.length; i < il; i++) {
                var btn = buttons.els[i];
                if (getAttribute(btn, 'data-sort') !== options.valueName) {
                    continue;
                }
                var predefinedOrder = getAttribute(btn, 'data-order');
                if (predefinedOrder == "asc" || predefinedOrder == "desc") {
                    if (predefinedOrder == options.order) {
                        classes(btn).add(options.order);
                    }
                } else {
                    classes(btn).add(options.order);
                }
            }
        }
    };
    var sort = function() {
        list.trigger('sortStart');
        options = {};

        var target = arguments[0].currentTarget || arguments[0].srcElement || undefined;

        if (target) {
            options.valueName = getAttribute(target, 'data-sort');
            buttons.getInSensitive(target, options);
            options.order = buttons.getOrder(target);
        } else {
            options = arguments[1] || options;
            options.valueName = arguments[0];
            options.order = options.order || "asc";
            options.insensitive = (typeof options.insensitive == "undefined") ? true : options.insensitive;
        }
        buttons.clear();
        buttons.setOrder(options);

        options.sortFunction = options.sortFunction || list.sortFunction;
        list.items.sort(function(a, b) {
            return options.sortFunction(a, b, options);
        });
        list.update();
        list.trigger('sortComplete');
    };

    // Add handlers
    list.handlers.sortStart = list.handlers.sortStart || [];
    list.handlers.sortComplete = list.handlers.sortComplete || [];

    buttons.els = getByClass(list.listContainer, list.sortClass);
    events.bind(buttons.els, 'click', sort);
    list.on('searchStart', buttons.clear);
    list.on('filterStart', buttons.clear);

    // Helpers
    list.helpers.classes = classes;
    list.helpers.naturalSort = naturalSort;
    list.helpers.events = events;
    list.helpers.getAttribute = getAttribute;

    return sort;
};

});
require.register("list.js/src/item.js", function(exports, require, module){
module.exports = function(list) {
    return function(initValues, element, notCreate) {
        var item = this;

        this._values = {};

        this.found = false; // Show if list.searched == true and this.found == true
        this.filtered = false;// Show if list.filtered == true and this.filtered == true

        var init = function(initValues, element, notCreate) {
            if (element === undefined) {
                if (notCreate) {
                    item.values(initValues, notCreate);
                } else {
                    item.values(initValues);
                }
            } else {
                item.elm = element;
                var values = list.templater.get(item, initValues);
                item.values(values);
            }
        };
        this.values = function(newValues, notCreate) {
            if (newValues !== undefined) {
                for(var name in newValues) {
                    item._values[name] = newValues[name];
                }
                if (notCreate !== true) {
                    list.templater.set(item, item.values());
                }
            } else {
                return item._values;
            }
        };
        this.show = function() {
            list.templater.show(item);
        };
        this.hide = function() {
            list.templater.hide(item);
        };
        this.matching = function() {
            return (
                (list.filtered && list.searched && item.found && item.filtered) ||
                (list.filtered && !list.searched && item.filtered) ||
                (!list.filtered && list.searched && item.found) ||
                (!list.filtered && !list.searched)
            );
        };
        this.visible = function() {
            return (item.elm.parentNode == list.list) ? true : false;
        };
        init(initValues, element, notCreate);
    };
};

});
require.register("list.js/src/templater.js", function(exports, require, module){
var getByClass = require('get-by-class');

var Templater = function(list) {
    var itemSource = getItemSource(list.item),
        templater = this;

    function getItemSource(item) {
        if (item === undefined) {
            var nodes = list.list.childNodes,
                items = [];

            for (var i = 0, il = nodes.length; i < il; i++) {
                // Only textnodes have a data attribute
                if (nodes[i].data === undefined) {
                    return nodes[i];
                }
            }
            return null;
        } else if (item.indexOf("<") !== -1) { // Try create html element of list, do not work for tables!!
            var div = document.createElement('div');
            div.innerHTML = item;
            return div.firstChild;
        } else {
            return document.getElementById(list.item);
        }
    }

    /* Get values from element */
    this.get = function(item, valueNames) {
        templater.create(item);
        var values = {};
        for(var i = 0, il = valueNames.length; i < il; i++) {
            var elm = getByClass(item.elm, valueNames[i], true);
            values[valueNames[i]] = elm ? elm.innerHTML : "";
        }
        return values;
    };

    /* Sets values at element */
    this.set = function(item, values) {
        if (!templater.create(item)) {
            for(var v in values) {
                if (values.hasOwnProperty(v)) {
                    // TODO speed up if possible
                    var elm = getByClass(item.elm, v, true);
                    if (elm) {
                        /* src attribute for image tag & text for other tags */
                        if (elm.tagName === "IMG" && values[v] !== "") {
                            elm.src = values[v];
                        } else {
                            elm.innerHTML = values[v];
                        }
                    }
                }
            }
        }
    };

    this.create = function(item) {
        if (item.elm !== undefined) {
            return false;
        }
        /* If item source does not exists, use the first item in list as
        source for new items */
        var newItem = itemSource.cloneNode(true);
        newItem.removeAttribute('id');
        item.elm = newItem;
        templater.set(item, item.values());
        return true;
    };
    this.remove = function(item) {
        list.list.removeChild(item.elm);
    };
    this.show = function(item) {
        templater.create(item);
        list.list.appendChild(item.elm);
    };
    this.hide = function(item) {
        if (item.elm !== undefined && item.elm.parentNode === list.list) {
            list.list.removeChild(item.elm);
        }
    };
    this.clear = function() {
        /* .innerHTML = ''; fucks up IE */
        if (list.list.hasChildNodes()) {
            while (list.list.childNodes.length >= 1)
            {
                list.list.removeChild(list.list.firstChild);
            }
        }
    };
};

module.exports = function(list) {
    return new Templater(list);
};

});
require.register("list.js/src/filter.js", function(exports, require, module){
module.exports = function(list) {

    // Add handlers
    list.handlers.filterStart = list.handlers.filterStart || [];
    list.handlers.filterComplete = list.handlers.filterComplete || [];

    return function(filterFunction) {
        list.trigger('filterStart');
        list.i = 1; // Reset paging
        list.reset.filter();
        if (filterFunction === undefined) {
            list.filtered = false;
        } else {
            list.filtered = true;
            var is = list.items;
            for (var i = 0, il = is.length; i < il; i++) {
                var item = is[i];
                if (filterFunction(item)) {
                    item.filtered = true;
                } else {
                    item.filtered = false;
                }
            }
        }
        list.update();
        list.trigger('filterComplete');
        return list.visibleItems;
    };
};

});
require.register("list.js/src/add-async.js", function(exports, require, module){
module.exports = function(list) {
    return function(values, callback, items) {
        var valuesToAdd = values.splice(0, 100);
        items = items || [];
        items = items.concat(list.add(valuesToAdd));
        if (values.length > 0) {
            setTimeout(function() {
                addAsync(values, callback, items);
            }, 10);
        } else {
            list.update();
            callback(items);
        }
    };
};
});
require.register("list.js/src/parse.js", function(exports, require, module){
module.exports = function(list) {

    var Item = require('./item')(list);

    var getChildren = function(parent) {
        var nodes = parent.childNodes,
            items = [];
        for (var i = 0, il = nodes.length; i < il; i++) {
            // Only textnodes have a data attribute
            if (nodes[i].data === undefined) {
                items.push(nodes[i]);
            }
        }
        return items;
    };

    var parse = function(itemElements, valueNames) {
        for (var i = 0, il = itemElements.length; i < il; i++) {
            list.items.push(new Item(valueNames, itemElements[i]));
        }
    };
    var parseAsync = function(itemElements, valueNames) {
        var itemsToIndex = itemElements.splice(0, 100); // TODO: If < 100 items, what happens in IE etc?
        parse(itemsToIndex, valueNames);
        if (itemElements.length > 0) {
            setTimeout(function() {
                init.items.indexAsync(itemElements, valueNames);
            }, 10);
        } else {
            list.update();
            // TODO: Add indexed callback
        }
    };

    return function() {
        var itemsToIndex = getChildren(list.list),
            valueNames = list.valueNames;

        if (list.indexAsync) {
            parseAsync(itemsToIndex, valueNames);
        } else {
            parse(itemsToIndex, valueNames);
        }
    };
};

});




















require.alias("component-classes/index.js", "list.js/deps/classes/index.js");
require.alias("component-classes/index.js", "classes/index.js");
require.alias("component-indexof/index.js", "component-classes/deps/indexof/index.js");

require.alias("segmentio-extend/index.js", "list.js/deps/extend/index.js");
require.alias("segmentio-extend/index.js", "extend/index.js");

require.alias("component-indexof/index.js", "list.js/deps/indexof/index.js");
require.alias("component-indexof/index.js", "indexof/index.js");

require.alias("javve-events/index.js", "list.js/deps/events/index.js");
require.alias("javve-events/index.js", "events/index.js");
require.alias("component-event/index.js", "javve-events/deps/event/index.js");

require.alias("timoxley-to-array/index.js", "javve-events/deps/to-array/index.js");

require.alias("javve-get-by-class/index.js", "list.js/deps/get-by-class/index.js");
require.alias("javve-get-by-class/index.js", "get-by-class/index.js");

require.alias("javve-get-attribute/index.js", "list.js/deps/get-attribute/index.js");
require.alias("javve-get-attribute/index.js", "get-attribute/index.js");

require.alias("javve-natural-sort/index.js", "list.js/deps/natural-sort/index.js");
require.alias("javve-natural-sort/index.js", "natural-sort/index.js");

require.alias("javve-to-string/index.js", "list.js/deps/to-string/index.js");
require.alias("javve-to-string/index.js", "list.js/deps/to-string/index.js");
require.alias("javve-to-string/index.js", "to-string/index.js");
require.alias("javve-to-string/index.js", "javve-to-string/index.js");
require.alias("component-type/index.js", "list.js/deps/type/index.js");
require.alias("component-type/index.js", "type/index.js");
if (typeof exports == "object") {
  module.exports = require("list.js");
} else if (typeof define == "function" && define.amd) {
  define(function(){ return require("list.js"); });
} else {
  this["List"] = require("list.js");
}})();
/**
 * SVGInjector v1.1.2 - Fast, caching, dynamic inline SVG DOM injection library
 * https://github.com/iconic/SVGInjector
 *
 * Copyright (c) 2014 Waybury <hello@waybury.com>
 * @license MIT
 */

(function (window, document) {

  'use strict';

  // Environment
  var isLocal = window.location.protocol === 'file:';
  var hasSvgSupport = document.implementation.hasFeature('http://www.w3.org/TR/SVG11/feature#BasicStructure', '1.1');

  function uniqueClasses(list) {
    list = list.split(' ');

    var hash = {};
    var i = list.length;
    var out = [];

    while (i--) {
      if (!hash.hasOwnProperty(list[i])) {
        hash[list[i]] = 1;
        out.unshift(list[i]);
      }
    }

    return out.join(' ');
  }

  /**
   * cache (or polyfill for <= IE8) Array.forEach()
   * source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
   */
  var forEach = Array.prototype.forEach || function (fn, scope) {
    if (this === void 0 || this === null || typeof fn !== 'function') {
      throw new TypeError();
    }

    /* jshint bitwise: false */
    var i, len = this.length >>> 0;
    /* jshint bitwise: true */

    for (i = 0; i < len; ++i) {
      if (i in this) {
        fn.call(scope, this[i], i, this);
      }
    }
  };

  // SVG Cache
  var svgCache = {};

  var injectCount = 0;
  var injectedElements = [];

  // Request Queue
  var requestQueue = [];

  // Script running status
  var ranScripts = {};

  var cloneSvg = function (sourceSvg) {
    return sourceSvg.cloneNode(true);
  };

  var queueRequest = function (url, callback) {
    requestQueue[url] = requestQueue[url] || [];
    requestQueue[url].push(callback);
  };

  var processRequestQueue = function (url) {
    for (var i = 0, len = requestQueue[url].length; i < len; i++) {
      // Make these calls async so we avoid blocking the page/renderer
      /* jshint loopfunc: true */
      (function (index) {
        setTimeout(function () {
          requestQueue[url][index](cloneSvg(svgCache[url]));
        }, 0);
      })(i);
      /* jshint loopfunc: false */
    }
  };

  var loadSvg = function (url, callback) {
    if (svgCache[url] !== undefined) {
      if (svgCache[url] instanceof SVGSVGElement) {
        // We already have it in cache, so use it
        callback(cloneSvg(svgCache[url]));
      }
      else {
        // We don't have it in cache yet, but we are loading it, so queue this request
        queueRequest(url, callback);
      }
    }
    else {

      if (!window.XMLHttpRequest) {
        callback('Browser does not support XMLHttpRequest');
        return false;
      }

      // Seed the cache to indicate we are loading this URL already
      svgCache[url] = {};
      queueRequest(url, callback);

      var httpRequest = new XMLHttpRequest();

      httpRequest.onreadystatechange = function () {
        // readyState 4 = complete
        if (httpRequest.readyState === 4) {

          // Handle status
          if (httpRequest.status === 404 || httpRequest.responseXML === null) {
            callback('Unable to load SVG file: ' + url);

            if (isLocal) callback('Note: SVG injection ajax calls do not work locally without adjusting security setting in your browser. Or consider using a local webserver.');

            callback();
            return false;
          }

          // 200 success from server, or 0 when using file:// protocol locally
          if (httpRequest.status === 200 || (isLocal && httpRequest.status === 0)) {

            /* globals Document */
            if (httpRequest.responseXML instanceof Document) {
              // Cache it
              svgCache[url] = httpRequest.responseXML.documentElement;
            }
            /* globals -Document */

            // IE9 doesn't create a responseXML Document object from loaded SVG,
            // and throws a "DOM Exception: HIERARCHY_REQUEST_ERR (3)" error when injected.
            //
            // So, we'll just create our own manually via the DOMParser using
            // the the raw XML responseText.
            //
            // :NOTE: IE8 and older doesn't have DOMParser, but they can't do SVG either, so...
            else if (DOMParser && (DOMParser instanceof Function)) {
              var xmlDoc;
              try {
                var parser = new DOMParser();
                xmlDoc = parser.parseFromString(httpRequest.responseText, 'text/xml');
              }
              catch (e) {
                xmlDoc = undefined;
              }

              if (!xmlDoc || xmlDoc.getElementsByTagName('parsererror').length) {
                callback('Unable to parse SVG file: ' + url);
                return false;
              }
              else {
                // Cache it
                svgCache[url] = xmlDoc.documentElement;
              }
            }

            // We've loaded a new asset, so process any requests waiting for it
            processRequestQueue(url);
          }
          else {
            callback('There was a problem injecting the SVG: ' + httpRequest.status + ' ' + httpRequest.statusText);
            return false;
          }
        }
      };

      httpRequest.open('GET', url);

      // Treat and parse the response as XML, even if the
      // server sends us a different mimetype
      if (httpRequest.overrideMimeType) httpRequest.overrideMimeType('text/xml');

      httpRequest.send();
    }
  };

  // Inject a single element
  var injectElement = function (el, evalScripts, pngFallback, callback) {

    // Grab the src or data-src attribute
    var imgUrl = el.getAttribute('data-src') || el.getAttribute('src');

    // We can only inject SVG
    if (!(/\.svg/i).test(imgUrl)) {
      callback('Attempted to inject a file with a non-svg extension: ' + imgUrl);
      return;
    }

    // If we don't have SVG support try to fall back to a png,
    // either defined per-element via data-fallback or data-png,
    // or globally via the pngFallback directory setting
    if (!hasSvgSupport) {
      var perElementFallback = el.getAttribute('data-fallback') || el.getAttribute('data-png');

      // Per-element specific PNG fallback defined, so use that
      if (perElementFallback) {
        el.setAttribute('src', perElementFallback);
        callback(null);
      }
      // Global PNG fallback directoriy defined, use the same-named PNG
      else if (pngFallback) {
        el.setAttribute('src', pngFallback + '/' + imgUrl.split('/').pop().replace('.svg', '.png'));
        callback(null);
      }
      // um...
      else {
        callback('This browser does not support SVG and no PNG fallback was defined.');
      }

      return;
    }

    // Make sure we aren't already in the process of injecting this element to
    // avoid a race condition if multiple injections for the same element are run.
    // :NOTE: Using indexOf() only _after_ we check for SVG support and bail,
    // so no need for IE8 indexOf() polyfill
    if (injectedElements.indexOf(el) !== -1) {
      return;
    }

    // Remember the request to inject this element, in case other injection
    // calls are also trying to replace this element before we finish
    injectedElements.push(el);

    // Try to avoid loading the orginal image src if possible.
    el.setAttribute('src', '');

    // Load it up
    loadSvg(imgUrl, function (svg) {

      if (typeof svg === 'undefined' || typeof svg === 'string') {
        callback(svg);
        return false;
      }

      var imgId = el.getAttribute('id');
      if (imgId) {
        svg.setAttribute('id', imgId);
      }

      var imgTitle = el.getAttribute('title');
      if (imgTitle) {
        svg.setAttribute('title', imgTitle);
      }

      // Concat the SVG classes + 'injected-svg' + the img classes
      var classMerge = [].concat(svg.getAttribute('class') || [], 'injected-svg', el.getAttribute('class') || []).join(' ');
      svg.setAttribute('class', uniqueClasses(classMerge));

      var imgStyle = el.getAttribute('style');
      if (imgStyle) {
        svg.setAttribute('style', imgStyle);
      }

      // Copy all the data elements to the svg
      var imgData = [].filter.call(el.attributes, function (at) {
        return (/^data-\w[\w\-]*$/).test(at.name);
      });
      forEach.call(imgData, function (dataAttr) {
        if (dataAttr.name && dataAttr.value) {
          svg.setAttribute(dataAttr.name, dataAttr.value);
        }
      });

      // Make sure any internally referenced clipPath ids and their
      // clip-path references are unique.
      //
      // This addresses the issue of having multiple instances of the
      // same SVG on a page and only the first clipPath id is referenced.
      //
      // Browsers often shortcut the SVG Spec and don't use clipPaths
      // contained in parent elements that are hidden, so if you hide the first
      // SVG instance on the page, then all other instances lose their clipping.
      // Reference: https://bugzilla.mozilla.org/show_bug.cgi?id=376027
      var clipPaths = svg.querySelectorAll('defs clipPath[id]');
      var newClipPathName;
      for (var g = 0, clipPathsLen = clipPaths.length; g < clipPathsLen; g++) {
        newClipPathName = clipPaths[g].id + '-' + injectCount;
        // :NOTE: using a substring match attr selector here to deal with IE "adding extra quotes in url() attrs"
        var usingClipPath = svg.querySelectorAll('[clip-path*="' + clipPaths[g].id + '"]');
        for (var h = 0, usingClipPathLen = usingClipPath.length; h < usingClipPathLen; h++) {
          usingClipPath[h].setAttribute('clip-path', 'url(#' + newClipPathName + ')');
        }
        clipPaths[g].id = newClipPathName;
      }

      // Do the same for masks
      var masks = svg.querySelectorAll('defs mask[id]');
      var newMaskName;
      for (var i = 0, masksLen = masks.length; i < masksLen; i++) {
        newMaskName = masks[i].id + '-' + injectCount;
        // :NOTE: using a substring match attr selector here to deal with IE "adding extra quotes in url() attrs"
        var usingMask = svg.querySelectorAll('[mask*="' + masks[i].id + '"]');
        for (var j = 0, usingMaskLen = usingMask.length; j < usingMaskLen; j++) {
          usingMask[j].setAttribute('mask', 'url(#' + newMaskName + ')');
        }
        masks[i].id = newMaskName;
      }

      // Remove any unwanted/invalid namespaces that might have been added by SVG editing tools
      svg.removeAttribute('xmlns:a');

      // Post page load injected SVGs don't automatically have their script
      // elements run, so we'll need to make that happen, if requested

      // Find then prune the scripts
      var scripts = svg.querySelectorAll('script');
      var scriptsToEval = [];
      var script, scriptType;

      for (var k = 0, scriptsLen = scripts.length; k < scriptsLen; k++) {
        scriptType = scripts[k].getAttribute('type');

        // Only process javascript types.
        // SVG defaults to 'application/ecmascript' for unset types
        if (!scriptType || scriptType === 'application/ecmascript' || scriptType === 'application/javascript') {

          // innerText for IE, textContent for other browsers
          script = scripts[k].innerText || scripts[k].textContent;

          // Stash
          scriptsToEval.push(script);

          // Tidy up and remove the script element since we don't need it anymore
          svg.removeChild(scripts[k]);
        }
      }

      // Run/Eval the scripts if needed
      if (scriptsToEval.length > 0 && (evalScripts === 'always' || (evalScripts === 'once' && !ranScripts[imgUrl]))) {
        for (var l = 0, scriptsToEvalLen = scriptsToEval.length; l < scriptsToEvalLen; l++) {

          // :NOTE: Yup, this is a form of eval, but it is being used to eval code
          // the caller has explictely asked to be loaded, and the code is in a caller
          // defined SVG file... not raw user input.
          //
          // Also, the code is evaluated in a closure and not in the global scope.
          // If you need to put something in global scope, use 'window'
          new Function(scriptsToEval[l])(window); // jshint ignore:line
        }

        // Remember we already ran scripts for this svg
        ranScripts[imgUrl] = true;
      }

      // Replace the image with the svg
      el.parentNode.replaceChild(svg, el);

      // Now that we no longer need it, drop references
      // to the original element so it can be GC'd
      delete injectedElements[injectedElements.indexOf(el)];
      el = null;

      // Increment the injected count
      injectCount++;

      callback(svg);
    });
  };

  /**
   * SVGInjector
   *
   * Replace the given elements with their full inline SVG DOM elements.
   *
   * :NOTE: We are using get/setAttribute with SVG because the SVG DOM spec differs from HTML DOM and
   * can return other unexpected object types when trying to directly access svg properties.
   * ex: "className" returns a SVGAnimatedString with the class value found in the "baseVal" property,
   * instead of simple string like with HTML Elements.
   *
   * @param {mixes} Array of or single DOM element
   * @param {object} options
   * @param {function} callback
   * @return {object} Instance of SVGInjector
   */
  var SVGInjector = function (elements, options, done) {

    // Options & defaults
    options = options || {};

    // Should we run the scripts blocks found in the SVG
    // 'always' - Run them every time
    // 'once' - Only run scripts once for each SVG
    // [false|'never'] - Ignore scripts
    var evalScripts = options.evalScripts || 'always';

    // Location of fallback pngs, if desired
    var pngFallback = options.pngFallback || false;

    // Callback to run during each SVG injection, returning the SVG injected
    var eachCallback = options.each;

    // Do the injection...
    if (elements.length !== undefined) {
      var elementsLoaded = 0;
      forEach.call(elements, function (element) {
        injectElement(element, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done && elements.length === ++elementsLoaded) done(elementsLoaded);
        });
      });
    }
    else {
      if (elements) {
        injectElement(elements, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done) done(1);
          elements = null;
        });
      }
      else {
        if (done) done(0);
      }
    }
  };

  /* global module, exports: true, define */
  // Node.js or CommonJS
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = exports = SVGInjector;
  }
  // AMD support
  else if (typeof define === 'function' && define.amd) {
    define(function () {
      return SVGInjector;
    });
  }
  // Otherwise, attach to window as global
  else if (typeof window === 'object') {
    window.SVGInjector = SVGInjector;
  }
  /* global -module, -exports, -define */

}(window, document));
;(function() {
  var $, AutoFill, AutoFillItem, BlockHints, DevPanel, DevPanelAjax, DevPanelList, DevPanelMsgObj, DevPanelXmlViewer, TabController,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  $ = jQuery.noConflict();


  /*
   * Ajax Message Response Handler
   *
   */

  DevPanelMsgObj = (function() {
    function DevPanelMsgObj() {}


    /*
     * Time with message is shown
     *
     * @var {Number}
     */

    DevPanelMsgObj.prototype.showTime = 3500;


    /*
     * Handle response and append message to DOM
     *
     * @param {Object} resp
     *
     * @return {DevPanelMsgObj}
     */

    DevPanelMsgObj.prototype.handle = function(resp) {
      var $msg;
      if (typeof resp.html === 'undefined') {
        return;
      }
      $msg = $(resp.html).filter('.ajax-message');
      $msg = this.addMsg($msg);
      $msg.on('click', (function(_this) {
        return function(event) {
          return _this.removeMsg($msg);
        };
      })(this));
      return this;
    };


    /*
     * Add message to DOM and animate
     *
     * @param {Object} $msg - jQuery element
     *
     * @return {Object} $msg
     */

    DevPanelMsgObj.prototype.addMsg = function($msg) {
      var area;
      area = $('#dev-panel .message-container');
      area.prepend($msg);
      TweenMax.from($msg, .3, {
        x: "-100%",
        ease: Back.easeOut
      }).eventCallback('onComplete', (function(_this) {
        return function() {
          return setTimeout(function() {
            return _this.removeMsg($msg);
          }, _this.showTime);
        };
      })(this));
      return $msg;
    };


    /*
     * Remove message fr0m dom
     *
     * @param {Object} $msg - jQuery element
     *
     * @return {Object} $msg
     */

    DevPanelMsgObj.prototype.removeMsg = function($msg) {
      TweenMax.to($msg, .3, {
        x: "-100%",
        ease: Back.easeOut
      }).eventCallback('onComplete', (function(_this) {
        return function() {
          return $msg.remove();
        };
      })(this));
      return $msg;
    };

    return DevPanelMsgObj;

  })();


  /*
   * Core Ajax Object
   *
   *
   */

  DevPanelAjax = (function() {

    /*
     * Constructor
     *
     * @param {Object} ajaxOpt - jQuery ajax options
     * @param {Object} options
     * @param {Object} respObj - Object to handle the ajax response
     *
     * @return {DevPanelAjax}
     */
    function DevPanelAjax(ajaxOpt, options, respObj) {
      this.ajaxOpt = ajaxOpt;
      this.success = __bind(this.success, this);
      this.beforeSend = __bind(this.beforeSend, this);
      this.options = options || {};
      this.respObj = respObj || new DevPanelMsgObj();
      this.devpanel = $('#dev-panel');
      this;
    }


    /*
     * Send Ajax request
     *
     * @return {Object}
     */

    DevPanelAjax.prototype.send = function() {
      var ajaxOpt;
      if (this.inProgress) {
        return;
      }
      ajaxOpt = this.ajaxOpt;
      ajaxOpt.beforeSend = this.ajaxOpt.beforeSend || this.beforeSend;
      ajaxOpt.success = this.ajaxOpt.success || this.success;
      ajaxOpt.error = this.ajaxOpt.error || this.error;
      if (typeof ajaxOpt.url === 'undefined') {
        throw "No URL defined for AJAX call.";
      }
      return $.ajax(ajaxOpt);
    };


    /*
     * Flag for if ajax is in progress
     *
     * @var {Boolean}
     */

    DevPanelAjax.prototype.inProgress = false;


    /*
     * Before AJAX send
     * Set loading classes etc.
     *
     * @return {DevPanelAjax}
     */

    DevPanelAjax.prototype.beforeSend = function() {
      this.inProgress = true;
      this.devpanel.addClass('devpanel-loading');
      if (typeof this.options.element !== 'undefined') {
        $(this.options.element).addClass('devpanel-loading');
      }
      return this;
    };


    /*
     * Success callback from AJAX request
     *
     * @param {Object} resp    - JSON response
     * @param {String} status
     * @param {Object} jqXHR
     *
     * @return {DevPanelAjax}
     */

    DevPanelAjax.prototype.success = function(resp, status, jqXHR) {
      this.respObj.handle(resp);
      this.devpanel.removeClass('devpanel-loading');
      if (typeof this.options.element !== 'undefined') {
        $(this.options.element).removeClass('devpanel-loading');
      }
      this.inProgress = false;
      return this;
    };

    return DevPanelAjax;

  })();


  /*
   * Dev Panel Autofill Forms Object
   *
   * @author Manne Busk <mannebusk@gmail.com>
   */

  $ = jQuery.noConflict();

  AutoFill = (function() {

    /*
     * Constructor
     *
     * @return {AutoFill}
     */
    function AutoFill(devpanel, formData) {
      this.devpanel = devpanel;
      this.insertEditor = __bind(this.insertEditor, this);
      this.registerEvents();
      this.editorContainerSel = '[data-autofill-editor]';
      this.createItems(formData);
      this.createList();
      this;
    }


    /*
     * Create searchable list with autofill files
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.createList = function() {
      this.list = new DevPanelList('autofill-form-list', ['title', 'selector'], 'form-autofill-search');
      this.list.search('');
      return this;
    };


    /*
     * Instanciate Javascript for each form
     *
     * @param {Object} forms - Object containing all forms
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.createItems = function(forms) {
      var data, filler, key, val;
      for (key in forms) {
        if (!__hasProp.call(forms, key)) continue;
        val = forms[key];
        data = val.form_data;
        delete val.form_data;
        filler = new AutoFillItem(this.devpanel, key, data, val);
        filler.responseHandler = this;
      }
      return this;
    };


    /*
     * Register event listeners
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.registerEvents = function() {
      $(this.devpanel.panel).on('click', '[data-autofill-new]', (function(_this) {
        return function(event) {
          return _this.getPageForms();
        };
      })(this));
      return this;
    };


    /*
     * Get all forms and display links in the list
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.getPageForms = function() {
      var list;
      this.clearList();
      list = $('#autofill-form-list .devpanel-detail-list');
      $('form').each(function() {
        var a, li;
        li = $('<li>');
        a = $('<a>').attr('href', '#' + $(this).attr('id')).attr('data-autofill-new-item', '').text("#" + $(this).attr('id'));
        li.append(a);
        return list.append(li);
      });
      $(this.devpanel.panel).on('click.newitem', '[data-autofill-new-item]', (function(_this) {
        return function(event) {
          var json;
          event.preventDefault();
          _this.clearList();
          json = _this.createNewJson($(event.target).attr('href'));
          return _this.createEditor(json);
        };
      })(this));
      return this;
    };


    /*
     * Create new Json string for form auto fill
     *
     * @param {String} selector - Form Selector
     *
     * @return {String}
     */

    AutoFill.prototype.createNewJson = function(selector) {
      var data, form, json;
      form = $(selector);
      data = form.serializeArray();
      json = {};
      json.title = $('.form-autofill-search').val() || selector;
      json.form = selector;
      json.submit = false;
      json.form_data = data;
      return JSON.stringify(json, null, '\t');
    };


    /*
     * Create editor
     *
     * @param {String} json
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.createEditor = function(json) {
      this.editor = CodeMirror(this.insertEditor, {
        value: json,
        mode: "application/json",
        theme: "monokai",
        lineWrapping: true,
        lineNumbers: true,
        gutter: true,
        gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
      });
      $(this.devpanel.panel).find('[data-autofill-save]').show();
      $(this.devpanel.panel).find('[data-autofill-new]').hide();
      $(this.devpanel.panel).on('click.save', '[data-autofill-save]', (function(_this) {
        return function(event) {
          var ajax, data, options, title, url;
          event.preventDefault();
          data = _this.editor.getValue();
          json = JSON.parse(data);
          url = $(event.target).closest('a').attr('href');
          title = $('.form-autofill-search').val() || json.form;
          options = {
            url: url,
            type: "post",
            data: {
              json: data,
              name: _this.safeString(title)
            }
          };
          ajax = new DevPanelAjax(options, {}, _this);
          return ajax.send();
        };
      })(this));
      return this;
    };


    /*
     * Clean up string to be safe as filename
     *
     * @param {String} string
     *
     * @return {String}
     */

    AutoFill.prototype.safeString = function(string) {
      return string.replace(/[^a-z0-9_-]/gi, '_').replace(/^[_]{1}/gi, '').toLowerCase();
    };


    /*
     * Handle ajax response
     *
     * @param {Object} resp
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.handle = function(resp) {
      var html, list, msgObj;
      msgObj = new DevPanelMsgObj;
      this.closeEditor();
      msgObj.handle(resp);
      if (typeof resp.forms !== 'undefined' && typeof resp.forms_html !== 'undefined') {
        list = $('#autofill-form-list .devpanel-detail-list');
        html = $(resp.forms_html);
        setTimeout((function(_this) {
          return function() {
            list.html(html);
            _this.devpanel.injectSvgs();
            return _this.createList();
          };
        })(this), 0);
        this.createItems(resp.forms);
      }
      return this;
    };


    /*
     * Add code editor to the DOM
     *
     * @param {Object} ed - CodeMirror editor
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.insertEditor = function(ed) {
      $(this.editorContainerSel).html(ed);
      return this;
    };


    /*
     * Close and remove editor
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.closeEditor = function() {
      $(this.devpanel.panel).off('click.save');
      $(this.devpanel.panel).find('[data-autofill-save]').hide();
      $(this.devpanel.panel).find('[data-autofill-new]').show();
      $(this.editorContainerSel).html("");
      return this;
    };


    /*
     * Clear the list
     *
     * @return {AutoFill}
     */

    AutoFill.prototype.clearList = function() {
      var list;
      $(this.devpanel.panel).off('click.newitem');
      list = $('#autofill-form-list .devpanel-detail-list');
      list.html("");
      return this;
    };


    /*
     * Debounce function to only trigger once per treshold time
     *
     * @param {Function}   func      - Function to execute
     * @param {Number}     threshold - Threshold time in ms
     * @param {Boolean}    execAsap  - If function should be execute at once
     *
     * @return {Function} timeout
     */

    AutoFill.prototype.debounce = function(func, threshold, execAsap) {
      var debounced, timeout;
      timeout = false;
      return debounced = function() {
        var args, delayed, obj;
        obj = this;
        args = arguments;
        delayed = function() {
          if (!execAsap) {
            func.apply(obj, args);
          }
          return timeout = null;
        };
        if (timeout) {
          clearTimeout(timeout);
        } else if (execAsap) {
          func.apply(obj, args);
        }
        timeout = setTimeout(delayed, threshold || 100);
        return timeout;
      };
    };

    return AutoFill;

  })();

  AutoFillItem = (function() {

    /*
     * Constructor
     *
     * @return {AutoFill}
     */
    function AutoFillItem(devpanel, name, formData, options) {
      this.devpanel = devpanel;
      this.name = name;
      this.formData = formData;
      this.options = options;
      this.registerEvents();
      this.registerDeleteItem();
      this.editorContainerSel = '[data-autofill-editor]';
      this;
    }


    /*
     * Register event listeners
     *
     * @return {AutoFill}
     */

    AutoFillItem.prototype.registerEvents = function() {
      $(this.devpanel.panel).on('click', '[data-devpanel-autofill="' + this.name + '"]', (function(_this) {
        return function(event) {
          event.preventDefault();
          _this.fillForm(_this.formData);
          if (_this.options.submit) {
            return setTimeout(function() {
              return $(_this.options.form).trigger('submit');
            }, 500);
          }
        };
      })(this));
      return this;
    };


    /*
     * Register event listener for deleteing items in list
     *
     * @return {AutoFill}
     */

    AutoFillItem.prototype.registerDeleteItem = function() {
      $(this.devpanel.panel).one('click.deleteitem', '[data-autofill-delete-item="' + this.name + '"]', (function(_this) {
        return function(event) {
          var ajax, elem, url;
          event.preventDefault();
          elem = $(event.target).closest('a');
          url = elem.attr('href');
          ajax = new DevPanelAjax({
            url: url
          }, {}, _this.responseHandler);
          return ajax.send();
        };
      })(this));
      return this;
    };


    /*
     * Fill form with data
     *
     * @param {Object} data - Serialized Array with form values
     *
     * @return {AutoFill}
     */

    AutoFillItem.prototype.fillForm = function(data) {
      var fields, forms, that;
      that = this;
      forms = $(this.options.form);
      data = this.parseSerializedArray(data);
      fields = forms.find(':input').filter((function(_this) {
        return function(idx, el) {
          var name;
          name = $(el).attr('name');
          return data.hasOwnProperty(name);
        };
      })(this));
      fields.each(function() {
        var el, name, type;
        el = this;
        name = $(el).attr('name');
        type = 'input';
        if (el.nodeName === 'SELECT') {
          type = 'select';
        } else if ($(el).attr('type') === 'checkbox' || $(el).attr('type') === 'radio') {
          type = 'check';
        }
        return setTimeout(function() {
          return that.fillField(el, type, data[name]);
        }, 0);
      });
      return this;
    };


    /*
     * Set value on field
     *
     * @param {Object} el    - jQuery element
     * @param {String} type  - Element type
     *
     * @return {AutoFill}
     */

    AutoFillItem.prototype.fillField = function(el, type, value) {
      if (type === 'input') {
        $(el).val(value);
        return;
      }
      if (type === 'select') {
        $(el).val(value);
        return;
      }
      if (type === 'check') {
        if ($(el).attr('value') === value) {
          $(el).attr('checked', '');
        }
      }
      $(el).trigger('change');
      return this;
    };


    /*
     * Parse Serialized array with form values to a more
     * straight forward object structure.
     *
     * @param {Object} data - Serialized Array with form values
     *
     * @return {Object}
     */

    AutoFillItem.prototype.parseSerializedArray = function(data) {
      var fields, idx, val;
      fields = {};
      for (idx in data) {
        if (!__hasProp.call(data, idx)) continue;
        val = data[idx];
        if (typeof fields[val.name] === 'undefined') {
          fields[val.name] = val.value;
        } else {
          console.log(val.name);
        }
      }
      return fields;
    };

    return AutoFillItem;

  })();


  /*
   * Block Hint Object
   *
   * @author Manne Busk
   */

  BlockHints = (function() {

    /*
     * Contstructor
     *
     * @param {Object} options
     *
     * @return {BlockHints}
     */
    function BlockHints(options) {
      this.options = options;
      this.blockExp = /^[\s]*block:[^\s]+[\s]*$/;
      this.blockNameExp = /^[\s]*block:([^\s]+)[\s]*$/;
      this.blockEndExp = /^[\s]*#block:[^\s]+[\s]*$/;
      this.blockEndNameExp = /^[\s]*#block:([^\s]+)[\s]*$/;
      this.hintActive = 'data-block-hint-active';
      this.hintHover = 'data-block-hint-hover';
      this.comments = this.getComments(document.querySelector('body'));
      this.registerEvents();
      this;
    }


    /*
     * Register event listeners
     *
     * @return {BlockHints}
     */

    BlockHints.prototype.registerEvents = function() {
      $('#block-info-list').on('click', 'li', (function(_this) {
        return function(event) {
          var active, blockEls, item, name, that;
          that = _this;
          item = $(event.target);
          if (!item.is('li')) {
            item = item.closest('li');
          }
          if (!item.find('.template').length) {
            return;
          }
          name = item.find('.name').text();
          blockEls = _this.getBlockElements(name);
          active = item.attr(that.hintActive);
          return $(blockEls).each(function() {
            if (typeof active === 'undefined' || active === false) {
              $(this).attr(that.hintActive, "");
              return item.attr(that.hintActive, "");
            } else {
              $(this).removeAttr(that.hintActive);
              return item.removeAttr(that.hintActive);
            }
          });
        };
      })(this));
      $('[data-toggle-hints]').on('click', (function(_this) {
        return function(event) {
          if (!_this.hintsOn) {
            return _this.onBlockHints();
          } else {
            return _this.offBlockHints();
          }
        };
      })(this));
      $('[data-hints-off]').on('click', (function(_this) {
        return function() {
          _this.offBlockHints();
          $('[' + _this.hintActive + ']').removeAttr(_this.hintActive);
          return $('[' + _this.hintHover + ']').removeAttr(_this.hintHover);
        };
      })(this));
      return this;
    };


    /*
     * Block Hints Enabled
     *
     * @var {Boolean}
     */

    BlockHints.prototype.hintsOn = false;


    /*
     * Turn on block hints
     *
     * @return {BlockHints}
     */

    BlockHints.prototype.onBlockHints = function() {
      var blockEls, comment, el, name, _i, _len, _ref;
      this.hintsOn = true;
      $('[' + this.hintActive + ']').removeAttr(this.hintActive);
      $('[' + this.hintHover + ']').removeAttr(this.hintHover);
      $('[data-toggle-hints]').addClass('active');
      _ref = this.comments;
      for (name in _ref) {
        if (!__hasProp.call(_ref, name)) continue;
        comment = _ref[name];
        blockEls = this.getBlockElements(name);
        for (_i = 0, _len = blockEls.length; _i < _len; _i++) {
          el = blockEls[_i];
          if ($(el).parents('#dev-panel').length || $(el).get(0) === $('#dev-panel')) {
            return;
          }
          $(el).attr('data-block-name', name);
          $(el).on('mouseenter.blockhints', (function(_this) {
            return function(event) {
              var block;
              $('[' + _this.hintHover + ']').removeAttr(_this.hintHover);
              block = $(event.target).closest('[data-block-name]');
              block.attr(_this.hintHover, "");
              return $(event.target).on('click.hoverhint', function(event) {
                var isIt;
                if (!_this.hintsOn) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                block = $(event.target);
                isIt = block.attr('data-block-name');
                if (typeof isIt === 'undefined' || isIt === false) {
                  block = block.closest('[data-block-name]');
                }
                name = block.attr('data-block-name');
                _this.options.searchObj.search(name, ['name']);
                block.attr(_this.hintActive, "");
                $('#block-info-list ul li').first().attr(_this.hintActive, "");
                $('.block-info-search').val(name);
                return _this.offBlockHints();
              });
            };
          })(this));
          $(el).on('mouseleave.blockhints', (function(_this) {
            return function(event) {
              var block;
              block = $(event.target).closest('[data-block-name]');
              block.removeAttr(_this.hintHover);
              return block.off('.hoverhint');
            };
          })(this));
        }
      }
      return this;
    };


    /*
     * Turn off block hints
     *
     * @return {BlockHints}
     */

    BlockHints.prototype.offBlockHints = function() {
      var blockEls, comment, el, name, _i, _len, _ref;
      this.hintsOn = false;
      $('[' + this.hintHover + ']').removeAttr(this.hintHover);
      $('[data-toggle-hints]').removeClass('active');
      _ref = this.comments;
      for (name in _ref) {
        if (!__hasProp.call(_ref, name)) continue;
        comment = _ref[name];
        blockEls = this.getBlockElements(name);
        for (_i = 0, _len = blockEls.length; _i < _len; _i++) {
          el = blockEls[_i];
          if ($(el).parents('#dev-panel').length || $(el).get(0) === $('#dev-panel')) {
            return;
          }
          $(el).off('.blockhints');
          $(el).off('.hoverhint');
        }
      }
    };


    /*
     * Get all html nodes between the comment nodes
     * for the specified blockname
     *
     * @param {String} name - Block name
     *
     * @return {Array}
     */

    BlockHints.prototype.getBlockElements = function(name) {
      var arr, finished, getNext, next, that;
      that = this;
      arr = [];
      finished = false;
      getNext = function(elem) {
        var end;
        if (!elem || finished) {
          return;
        }
        if (elem.nodeType === 8) {
          if (elem.nodeValue) {
            end = elem.nodeValue.match(that.blockEndNameExp);
            if (end && end[1] === name) {
              finished = true;
              return;
            }
          }
        }
        if (elem.nodeType !== 1) {
          if (elem.nextSibling) {
            getNext(elem.nextSibling);
          } else {
            return;
          }
        }
        if (!finished) {
          arr.push(elem);
        } else {
          return;
        }
        if (elem.nextSibling) {
          return getNext(elem.nextSibling);
        } else {

        }
      };
      if (typeof this.comments[name] !== 'undefined') {
        next = this.comments[name].nextSibling;
        getNext(next);
      }
      return arr;
    };


    /*
     * Get All block comments inside element
     *
     * @param {Object} elem - Html element
     *
     * @return {Object} res
     */

    BlockHints.prototype.getComments = function(elem) {
      var getNext, res;
      res = {};
      getNext = (function(_this) {
        return function(elem) {
          var child, children, name, _i, _len, _results;
          children = elem.childNodes;
          _results = [];
          for (_i = 0, _len = children.length; _i < _len; _i++) {
            child = children[_i];
            if (child.nodeType === 1) {
              continue;
            }
            if (child.nodeType === 8) {
              name = child.nodeValue.match(_this.blockNameExp);
              if (name) {
                res[name[1]] = child;
              }
              continue;
            }
            if (child.childNodes) {
              getNext(child);
            }
            if (child.nextSibling) {
              _results.push(getNext(child.nextSibling));
            } else {
              _results.push(void 0);
            }
          }
          return _results;
        };
      })(this);
      getNext(elem);
      return res;
    };

    return BlockHints;

  })();


  /*
   * Config XML Viewer
   *
   */

  $ = jQuery.noConflict();

  DevPanelXmlViewer = (function() {

    /*
     * Constructor
     *
     * @param {Object} options
     *
     * @return {DevPanelXmlViewer}
     */
    function DevPanelXmlViewer(options) {
      this.insertEditor = __bind(this.insertEditor, this);
      this.options = options;
      this.triggerSel = '[data-xmlviewer-fetch]';
      this.inputSel = '[data-xmlviewer-input]';
      this.clearSel = '[data-xmlviewer-clear]';
      this.editorContainerSel = '[data-xmlviewer-code]';
      this.examplesSel = '[data-xmlviewer-examples]';
      this.registerEvents();
      this;
    }


    /*
     * Register event listeners
     *
     * @return {DevPanelXmlViewer}
     */

    DevPanelXmlViewer.prototype.registerEvents = function() {
      $(this.inputSel).on('keyup', (function(_this) {
        return function(event) {
          var key, xpath;
          key = event.keyCode;
          if (key === 13) {
            xpath = $(_this.inputSel).val();
            return _this.getXml(xpath);
          }
        };
      })(this));
      $(this.triggerSel).on('click', (function(_this) {
        return function(event) {
          var xpath;
          event.preventDefault();
          xpath = $(_this.inputSel).val();
          return _this.getXml(xpath);
        };
      })(this));
      $(this.clearSel).on('click', (function(_this) {
        return function(event) {
          $(_this.inputSel).val("");
          return $(_this.editorContainerSel).html("");
        };
      })(this));
      $(this.examplesSel).on('click', (function(_this) {
        return function(event) {
          event.preventDefault();
          return $(_this.inputSel).val($(event.target).text()).focus();
        };
      })(this));
      return this;
    };


    /*
     * Fetch XML via ajax request
     *
     * @param {String} xpath
     *
     * @return {DevPanelXmlViewer}
     */

    DevPanelXmlViewer.prototype.getXml = function(xpath) {
      var ajaxOpt, ajaxer;
      ajaxOpt = {
        url: $(this.triggerSel).attr('href'),
        type: "get",
        data: {
          xpath: xpath
        }
      };
      ajaxer = new DevPanelAjax(ajaxOpt, {}, this);
      ajaxer.send();
      return this;
    };


    /*
     * Handle Ajax response
     *
     * @param {Object} resp
     *
     * @return {DevPanelAjax}
     */

    DevPanelXmlViewer.prototype.handle = function(resp) {
      if (typeof resp.redirect !== 'undefined') {
        window.location.href = resp.redirect;
      }
      if (typeof resp.html !== 'undefined') {
        this.createEditor(resp.html);
      }
      return this;
    };


    /*
     * Create CodeMirror editor
     *
     * @param {String} content
     *
     * @return {DevPanelAjax}
     */

    DevPanelXmlViewer.prototype.createEditor = function(content) {
      this.editor = CodeMirror(this.insertEditor, {
        value: content,
        mode: "application/xml",
        theme: "monokai",
        lineWrapping: true,
        lineNumbers: true,
        gutter: true,
        gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
        foldGutter: {
          rangeFinder: new CodeMirror.fold.combine(CodeMirror.fold.xml)
        }
      });
      this.editor.on('gutterClick', (function(_this) {
        return function(cm, ln, gutter) {
          return _this.editor.foldCode(ln);
        };
      })(this));
      return this;
    };


    /*
     * Add code editor to the DOM
     *
     * @param {Object} ed - CodeMirror editor
     *
     * @return {DevPanelAjax}
     */

    DevPanelXmlViewer.prototype.insertEditor = function(ed) {
      $(this.editorContainerSel).html(ed);
      return this;
    };

    return DevPanelXmlViewer;

  })();


  /*
   * Dev Panel Core Object
   *
   * @author Manne Busk <mannebusk@gmail.com>
   */

  $ = jQuery.noConflict();

  DevPanel = (function() {

    /*
     * Constructor
     *
     * @return {WhCore}
     */
    function DevPanel(config) {
      var that;
      this.config = config;
      this.panel = '#dev-panel';
      that = this;
      $(this.panel).on('click', '.toggle', function(event) {
        event.preventDefault();
        return that.togglePanel();
      });
      this.load();
      this.initAutofill();
      this.injectSvgs();
      this;
    }


    /*
     * Toggle panel
     *
     * @return {WhCore}
     */

    DevPanel.prototype.togglePanel = function() {
      if ($(this.panel).hasClass('closed')) {
        this.open();
      } else {
        this.close();
      }
      return this;
    };


    /*
     * Open Panel
     *
     * @return {WhCore}
     */

    DevPanel.prototype.open = function() {
      var btn, that, to, tw, tween;
      that = this;
      to = {
        y: 0
      };
      btn = $(this.panel).find('.toggle');
      tw = TweenMax.to(btn, 0.1, {
        y: btn.outerHeight()
      });
      tw.eventCallback('onComplete', (function(_this) {
        return function() {
          return btn.removeAttr('style');
        };
      })(this));
      tween = TweenMax.to($(this.panel), 0.2, to);
      tween.eventCallback('onComplete', function() {
        $(that.panel).removeClass('closed').removeAttr('style');
        btn.removeAttr('style');
        return that.save();
      });
      return this;
    };


    /*
     * Close Panel
     *
     * @return {WhCore}
     */

    DevPanel.prototype.close = function() {
      var btn, height, that, to, tween;
      that = this;
      height = $(window).height() / 2;
      to = {
        y: height
      };
      btn = $(this.panel).find('.toggle');
      TweenMax.to(btn, 0.2, {
        y: 0
      }).eventCallback('onComplete', (function(_this) {
        return function() {
          return btn.removeAttr('style');
        };
      })(this));
      tween = TweenMax.to($(this.panel), 0.2, to);
      tween.eventCallback('onComplete', function() {
        $(that.panel).addClass('closed').removeAttr('style');
        return that.save();
      });
      return this;
    };


    /*
     * Set up autofill for forms
     *
     * @return {WhCore}
     */

    DevPanel.prototype.initAutofill = function() {
      this.autoFill = new AutoFill(this, this.config.formAutoFill);
      return this;
    };


    /*
     * Save panel state to localstorage
     *
     * @return {WhCore}
     */

    DevPanel.prototype.save = function() {
      var open, state;
      open = false;
      if ($(this.panel).hasClass('closed')) {
        open = false;
      } else {
        open = true;
      }
      state = {
        open: open
      };
      localStorage.setItem('devpanel', JSON.stringify(state));
      return this;
    };


    /*
     * Load panel state from localstorage
     *
     * @return {WhCore}
     */

    DevPanel.prototype.load = function() {
      var state;
      state = JSON.parse(localStorage.getItem('devpanel'));
      if (!state) {
        return;
      }
      if (state.open) {
        this.open();
      } else {
        this.close();
      }
      return this;
    };


    /*
     * Inject Inline SVG's
     */

    DevPanel.prototype.injectSvgs = function() {
      var svgs;
      svgs = document.querySelectorAll('img.dpsvg');
      SVGInjector(svgs);
      return this;
    };


    /*
     * Debounce function to only trigger once per treshold time
     *
     * @param {Function}   func      - Function to execute
     * @param {Number}     threshold - Threshold time in ms
     * @param {Boolean}    execAsap  - If function should be execute at once
     *
     * @return {Function} timeout
     */

    DevPanel.prototype.debounce = function(func, threshold, execAsap) {
      var debounced, timeout;
      timeout = false;
      return debounced = function() {
        var args, delayed, obj;
        obj = this;
        args = arguments;
        delayed = function() {
          if (!execAsap) {
            func.apply(obj, args);
          }
          return timeout = null;
        };
        if (timeout) {
          clearTimeout(timeout);
        } else if (execAsap) {
          func.apply(obj, args);
        }
        timeout = setTimeout(delayed, threshold || 100);
        return timeout;
      };
    };

    return DevPanel;

  })();

  window.DevPanel = DevPanel;


  /*
   * DevPanel List Object
   *
   */

  DevPanelList = (function() {

    /*
     * Constructor
     *
     * @param {String} id          - HTML Id
     * @param {Array}  attributes  - Attributes to search in
     * @param {String} inputClass  - Class for input element
     * @param {Object} options     - General options
     *
     * @return {DevPanelList}
     */
    function DevPanelList(id, attributes, inputClass, options) {
      this.id = id;
      this.attributes = attributes;
      this.inputClass = inputClass;
      this.options = options;
      options = {
        valueNames: this.attributes,
        searchClass: this.inputClass
      };
      this.list = new List(this.id, options);
      this.listWrapper = $('#' + this.id);
      this.listWrapper.on('click', '[data-search-clear]', (function(_this) {
        return function(event) {
          return _this.search();
        };
      })(this));
      this.listWrapper.find('.' + this.inputClass).on('keyup', (function(_this) {
        return function(event) {
          return _this.save(_this.listWrapper.find('.' + _this.inputClass).val());
        };
      })(this));
      this.load();
      this;
    }


    /*
     * Search in list
     *
     * @param {String} string      - Search value
     * @param {Array}  attributes  - Attributes to search in
     *
     * @return {DevPanelList}
     */

    DevPanelList.prototype.search = function(string, attributes) {
      this.list.search(string, attributes);
      this.listWrapper.find('.' + this.inputClass).val(string);
      this.save(string, attributes);
      return this;
    };


    /*
     * Save List state to localstorage
     *
     * @param {String} string      - Search value
     * @param {Array}  attributes  - Attributes to search in
     *
     * @return {DevPanelList}
     */

    DevPanelList.prototype.save = function(string, attributes) {
      var attr, state;
      attr = attributes || this.attributes;
      state = {
        value: string,
        attributes: attr
      };
      localStorage.setItem('devpanel.search.' + this.id, JSON.stringify(state));
      return this;
    };


    /*
     * Load List state from localstorage
     *
     * @return {DevPanelList}
     */

    DevPanelList.prototype.load = function() {
      var state;
      state = JSON.parse(localStorage.getItem('devpanel.search.' + this.id));
      if (!state) {
        return;
      }
      this.search(state.value, state.attributes);
      return this;
    };

    return DevPanelList;

  })();


  /*
   * Prototype for Arrays filter function.
   * Needs to be reset as Prototype library overrides this one.
   */

  Array.prototype.filter = function(fun) {
    'use strict';
    var i, len, res, t, thisArg, val, _i, _len, _ref;
    if (this === 0 || this === null) {
      throw new TypeError();
    }
    t = Object(this);
    len = t.length >>> 0;
    if (typeof fun !== 'function') {
      throw new TypeError();
    }
    res = [];
    if (arguments.length >= 2) {
      thisArg = arguments[1];
    } else {
      thisArg = 0;
    }
    _ref = t.length;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      i = _ref[_i];
      if (__indexOf.call(t, i) >= 0) {
        val = t[i];

        /*
        // NOTE: Technically this should Object.defineProperty at
        //       the next index, as push can be affected by
        //       properties on Object.prototype and Array.prototype.
        //       But that method's new, and collisions should be
        //       rare, so use the more-compatible alternative.
         */
        if (fun.call(thisArg, val, i, t)) {
          res.push(val);
        }
      }
    }
    return res;
  };


  /*
   * Main Coffeescript file. Initializes stuff when DOM is ready.
   *
   * @author Manne Busk <mannebusk@gmail.com>
   */

  $ = jQuery.noConflict();

  $(function() {
    var blockHints, blockSearch, handleSearch, storeSearch, userAdmin, userFrontend, xmlViewer;
    $('[data-tabcontroller]').tabController();

    /*
     * List Searches
     */
    blockSearch = new DevPanelList('block-info-list', ['name', 'class', 'template'], 'block-info-search');
    handleSearch = new DevPanelList('layout-handle-list', ['handle'], 'layout-handle-search');
    storeSearch = new DevPanelList('store-list', ['website', 'store', 'code', 'id', 'store-id', 'store-code'], 'store-search');
    userFrontend = new DevPanelList('frontend-login-list', ['name', 'email'], 'user-frontend-input');
    userAdmin = new DevPanelList('admin-login-list', ['name', 'email'], 'user-admin-input');

    /*
     * Block hints
     */
    blockHints = new BlockHints({
      searchObj: blockSearch
    });

    /*
     * Clear Cache
     */
    $('[data-devpanel-ajax]').on('click', (function(_this) {
      return function(event) {
        var ajax, options;
        event.preventDefault();
        options = {
          url: $(event.target).attr('href')
        };
        return ajax = new DevPanelAjax(options).send();
      };
    })(this));

    /*
     * Config XML Viewer
     */
    return xmlViewer = new DevPanelXmlViewer;
  });


  /*
   * Tab Controller
   *
   * @author Manne Busk <mannebusk@gmail.com>
   */

  $ = jQuery.noConflict();

  TabController = (function() {

    /*
     * Constructor
     *
     * @param {Object} controller  - jQuery element
     * @param {Object} config      - General settings
     *
     * @return {WhCore}
     */
    function TabController(controller, config) {
      this.controller = controller;
      this.config = config;
      this.ns = this.controller.attr('data-tabcontroller');
      this.tabSel = '[data-' + this.ns + '-tab]';
      this.tabContentSel = '[data-' + this.ns + '-tabcontent]';
      this.activeSel = '[data-' + this.ns + '-tab].active';
      $(this.tabContentSel).hide();
      this.loadState();
      this.controller.find(this.tabSel + ' a').on('click', (function(event) {
        var tab;
        tab = $(event.target).closest(this.tabSel);
        return this.changeTab(tab);
      }).bind(this));
    }


    /*
     * Change tab to view
     *
     * @param {Object} tab - jQuery element
     *
     * @return {WhCore}
     */

    TabController.prototype.changeTab = function(tab) {
      var content, currentAnim, hide, prevAnim, prevContent, show;
      prevContent = this.getContentForTab($(this.activeSel));
      content = this.getContentForTab(tab);
      this.controller.find(this.tabSel).removeClass('active');
      tab.addClass('active');
      hide = {
        opacity: 0
      };
      show = {
        opacity: 1
      };
      prevAnim = TweenMax.fromTo(prevContent, 0.1, show, hide);
      prevAnim.eventCallback('onComplete', function() {
        return prevContent.removeAttr('style').hide();
      });
      currentAnim = TweenMax.fromTo(content, 0.1, hide, show);
      currentAnim.eventCallback('onComplete', function() {
        return content.removeAttr('style');
      });
      this.saveState();
      return this;
    };


    /*
     * Get content element asociated with tab
     *
     * @param {Object} tab - jQuery element
     *
     * @return {Object}
     */

    TabController.prototype.getContentForTab = function(tab) {
      var id, str;
      id = tab.attr(this.tabSel.replace('[', '').replace(']', ''));
      str = '="' + id + '"]';
      return $(this.tabContentSel.replace(']', str));
    };


    /*
     * Save state to localstorage
     *
     * @return {Object}
     */

    TabController.prototype.saveState = function() {
      var state;
      state = {
        active: this.controller.find(this.activeSel).attr(this.tabSel.replace('[', '').replace(']', ''))
      };
      localStorage.setItem('devpanel.tabs.' + this.ns, JSON.stringify(state));
      return this;
    };


    /*
     * Load state from localstorage
     *
     * @return {Object}
     */

    TabController.prototype.loadState = function() {
      var state, tab;
      state = JSON.parse(localStorage.getItem('devpanel.tabs.' + this.ns));
      if (state && state.active) {
        tab = this.controller.find(this.tabSel.replace(']', '="' + state.active + '"]'));
      } else {
        tab = this.controller.find(this.activeSel);
      }
      this.changeTab(tab);
      return this;
    };

    return TabController;

  })();


  /*
   * jQuery Plugin
   *
   */

  $.fn.tabController = function(options) {
    options = options || {};
    return $(this).each(function() {
      return $(this).data('TabController', new TabController($(this)), options);
    });
  };

}).call(this);
