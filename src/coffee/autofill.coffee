###
# Dev Panel Autofill Forms Object
#
# @author Manne Busk <mannebusk@gmail.com>
###
$ = jQuery.noConflict()

class AutoFill
  ###
  # Constructor
  #
  # @return {AutoFill}
  ###
  constructor: (@devpanel, formData)->
    @registerEvents()
    @editorContainerSel = '[data-autofill-editor]'

    @createItems(formData)

    @createList()
    @

  ###
  # Create searchable list with autofill files
  #
  # @return {AutoFill}
  ###
  createList: ->
    @list = new DevPanelList('autofill-form-list', ['title', 'selector'], 'form-autofill-search')
    @list.search('')
    @

  ###
  # Instanciate Javascript for each form
  #
  # @param {Object} forms - Object containing all forms
  #
  # @return {AutoFill}
  ###
  createItems: (forms)->
    for own key, val of forms
      data = val.form_data
      delete val.form_data
      filler = new AutoFillItem(@devpanel, key, data, val)
      filler.responseHandler = @
    @

  ###
  # Register event listeners
  #
  # @return {AutoFill}
  ###
  registerEvents: ->

    $(@devpanel.panel).on('click', '[data-autofill-new]', (event)=>
      @getPageForms()
    )
    @

  ###
  # Get all forms and display links in the list
  #
  # @return {AutoFill}
  ###
  getPageForms: ->
    @clearList()
    list = $('#autofill-form-list .devpanel-detail-list')

    $('form').each(->
      li = $('<li>')
      a = $('<a>').attr('href', '#' + $(@).attr('id'))
        .attr('data-autofill-new-item', '')
        .text("#" + $(@).attr('id'))
      li.append(a)
      list.append(li)
    )

    $(@devpanel.panel).on('click.newitem', '[data-autofill-new-item]', (event)=>
      event.preventDefault()
      @clearList()
      json = @createNewJson($(event.target).attr('href'))
      @createEditor(json)
    )
    @

  ###
  # Create new Json string for form auto fill
  #
  # @param {String} selector - Form Selector
  #
  # @return {String}
  ###
  createNewJson: (selector)->
    form = $(selector)
    data = form.serializeArray()
    json = {}
    json.title = $('.form-autofill-search').val() || selector
    json.form = selector
    json.submit = false
    json.form_data = data

    return JSON.stringify(json, null, '\t')

  ###
  # Create editor
  #
  # @param {String} json
  #
  # @return {AutoFill}
  ###
  createEditor: (json)->
    @editor = CodeMirror(@insertEditor, {
      value: json
      mode: "application/json"
      theme: "monokai"
      lineWrapping: true
      lineNumbers: true
      gutter: true
      gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
    })

    $(@devpanel.panel).find('[data-autofill-save]').show()
    $(@devpanel.panel).find('[data-autofill-new]').hide()

    $(@devpanel.panel).on('click.save', '[data-autofill-save]', (event)=>
      event.preventDefault()
      data = @editor.getValue()
      json = JSON.parse(data)

      url = $(event.target).closest('a').attr('href')

      title = $('.form-autofill-search').val() || json.form

      options =
        url: url
        type: "post"
        data:
          json: data
          name: @safeString(title)

      ajax = new DevPanelAjax(options, {}, @)
      ajax.send()
    )
    @

  ###
  # Clean up string to be safe as filename
  #
  # @param {String} string
  #
  # @return {String}
  ###
  safeString: (string)->
    return string.replace(/[^a-z0-9_-]/gi, '_')
      .replace(/^[_]{1}/gi, '')
      .toLowerCase()

  ###
  # Handle ajax response
  #
  # @param {Object} resp
  #
  # @return {AutoFill}
  ###
  handle: (resp)->
    msgObj = new DevPanelMsgObj
    @closeEditor()
    msgObj.handle(resp)

    if typeof resp.forms != 'undefined' and typeof resp.forms_html != 'undefined'
      list = $('#autofill-form-list .devpanel-detail-list')
      html = $(resp.forms_html)
      setTimeout(=>
        list.html(html)
        @devpanel.injectSvgs()
        @createList()
      , 0)
      @createItems(resp.forms)
    @

  ###
  # Add code editor to the DOM
  #
  # @param {Object} ed - CodeMirror editor
  #
  # @return {AutoFill}
  ###
  insertEditor: (ed)=>
    $(@editorContainerSel).html(ed)
    @

  ###
  # Close and remove editor
  #
  # @return {AutoFill}
  ###
  closeEditor: ->
    $(@devpanel.panel).off('click.save')
    $(@devpanel.panel).find('[data-autofill-save]').hide()
    $(@devpanel.panel).find('[data-autofill-new]').show()
    $(@editorContainerSel).html("")
    @

  ###
  # Clear the list
  #
  # @return {AutoFill}
  ###
  clearList: ->
    $(@devpanel.panel).off('click.newitem')
    list = $('#autofill-form-list .devpanel-detail-list')
    list.html("")
    @



  ###
  # Debounce function to only trigger once per treshold time
  #
  # @param {Function}   func      - Function to execute
  # @param {Number}     threshold - Threshold time in ms
  # @param {Boolean}    execAsap  - If function should be execute at once
  #
  # @return {Function} timeout
  ###
  debounce: (func, threshold, execAsap) ->
    timeout = false

    return debounced = ->
      obj = this
      args = arguments

      delayed = ->
        func.apply(obj, args) unless execAsap
        timeout = null

      if timeout
        clearTimeout(timeout)
      else if (execAsap)
        func.apply(obj, args)

      timeout = setTimeout delayed, threshold || 100
      return timeout


class AutoFillItem
  ###
  # Constructor
  #
  # @return {AutoFill}
  ###
  constructor: (@devpanel, @name, @formData, @options)->
    @registerEvents()
    @registerDeleteItem()
    @editorContainerSel = '[data-autofill-editor]'
    @


  ###
  # Register event listeners
  #
  # @return {AutoFill}
  ###
  registerEvents: ->
    $(@devpanel.panel).on('click', '[data-devpanel-autofill="' + @name + '"]', (event)=>
      event.preventDefault()

      @fillForm(@formData)
      if @options.submit
        setTimeout(=>
          $(@options.form).trigger('submit')
        , 500)
    )
    @

  ###
  # Register event listener for deleteing items in list
  #
  # @return {AutoFill}
  ###
  registerDeleteItem: ->
    $(@devpanel.panel).one('click.deleteitem', '[data-autofill-delete-item="' + @name + '"]', (event)=>
      event.preventDefault()
      elem = $(event.target).closest('a')
      url = elem.attr('href')

      ajax = new DevPanelAjax({url: url}, {}, @responseHandler)
      ajax.send()
    )

    @

  ###
  # Fill form with data
  #
  # @param {Object} data - Serialized Array with form values
  #
  # @return {AutoFill}
  ###
  fillForm: (data)->
    that = @
    forms = $(@options.form)
    data = @parseSerializedArray(data)

    fields = forms.find(':input').filter((idx, el)=>
      name = $(el).attr('name')
      return data.hasOwnProperty(name)
    )
    fields.each(->
      el = @
      name = $(el).attr('name')
      type = 'input'

      if el.nodeName == 'SELECT'
        type = 'select'
      else if $(el).attr('type') == 'checkbox' || $(el).attr('type') == 'radio'
        type = 'check'

      setTimeout(->
        that.fillField(el, type, data[name])
      , 0)
    )
    @

  ###
  # Set value on field
  #
  # @param {Object} el    - jQuery element
  # @param {String} type  - Element type
  #
  # @return {AutoFill}
  ###
  fillField: (el, type, value)->
    if type == 'input'
      $(el).val(value)
      return
    if type == 'select'
      $(el).val(value)
      return
    if type == 'check'
      if $(el).attr('value') == value
        $(el).attr('checked', '')
    $(el).trigger('change')
    @

  ###
  # Parse Serialized array with form values to a more
  # straight forward object structure.
  #
  # @param {Object} data - Serialized Array with form values
  #
  # @return {Object}
  ###
  parseSerializedArray: (data)->
    fields = {}
    for own idx, val of data
      if typeof fields[val.name] == 'undefined'
        fields[val.name] = val.value
      else
        console.log val.name
    return fields
