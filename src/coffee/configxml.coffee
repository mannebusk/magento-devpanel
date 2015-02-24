###
# Config XML Viewer
#
###
$ = jQuery.noConflict()

class DevPanelXmlViewer
  ###
  # Constructor
  #
  # @param {Object} options
  #
  # @return {DevPanelXmlViewer}
  ###
  constructor: (options)->
    @options = options

    @triggerSel         = '[data-xmlviewer-fetch]'
    @inputSel           = '[data-xmlviewer-input]'
    @clearSel           = '[data-xmlviewer-clear]'
    @editorContainerSel = '[data-xmlviewer-code]'
    @examplesSel        = '[data-xmlviewer-examples]'

    @registerEvents()
    @

  ###
  # Register event listeners
  #
  # @return {DevPanelXmlViewer}
  ###
  registerEvents: ->
    $(@inputSel).on('keyup', (event)=>
      key = event.keyCode
      if key == 13
        xpath = $(@inputSel).val()
        @getXml(xpath)
    )

    $(@triggerSel).on('click', (event)=>
      event.preventDefault()
      xpath = $(@inputSel).val()
      @getXml(xpath)
    )

    $(@clearSel).on('click', (event)=>
      $(@inputSel).val("")
      $(@editorContainerSel).html("")
    )

    $(@examplesSel).on('click', (event)=>
      event.preventDefault()
      $(@inputSel).val($(event.target).text()).focus()
    )

    @

  ###
  # Fetch XML via ajax request
  #
  # @param {String} xpath
  #
  # @return {DevPanelXmlViewer}
  ###
  getXml: (xpath)->
    ajaxOpt =
      url: $(@triggerSel).attr 'href'
      type: "get"
      data:
        xpath: xpath

    ajaxer = new DevPanelAjax(ajaxOpt, {}, @)
    ajaxer.send()
    @

  ###
  # Handle Ajax response
  #
  # @param {Object} resp
  #
  # @return {DevPanelAjax}
  ###
  handle: (resp)->
    if typeof resp.redirect != 'undefined'
      window.location.href = resp.redirect

    if typeof resp.html != 'undefined'
      @createEditor(resp.html)
    @

  ###
  # Create CodeMirror editor
  #
  # @param {String} content
  #
  # @return {DevPanelAjax}
  ###
  createEditor: (content)->
    @editor = CodeMirror(@insertEditor, {
      value: content
      mode: "application/xml"
      theme: "monokai"
      lineWrapping: true
      lineNumbers: true
      gutter: true
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
      foldGutter:
        rangeFinder: new CodeMirror.fold.combine(CodeMirror.fold.xml)
    })

    @editor.on('gutterClick', (cm, ln, gutter)=>
      @editor.foldCode(ln)
    )

    @

  ###
  # Add code editor to the DOM
  #
  # @param {Object} ed - CodeMirror editor
  #
  # @return {DevPanelAjax}
  ###
  insertEditor: (ed)=>
    $(@editorContainerSel).html(ed)
    @
