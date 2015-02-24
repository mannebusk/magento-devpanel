###
# Ajax Objects
#
# @author Manne Busk <mannebusk@gmail.com>
###
$ = jQuery.noConflict()

###
# Ajax Message Response Handler
#
###
class DevPanelMsgObj
  ###
  # Time with message is shown
  #
  # @var {Number}
  ###
  showTime: 3500

  ###
  # Handle response and append message to DOM
  #
  # @param {Object} resp
  #
  # @return {DevPanelMsgObj}
  ###
  handle: (resp)->
    if typeof resp.html == 'undefined'
      return

    $msg = $(resp.html).filter('.ajax-message')
    $msg = @addMsg($msg)
    $msg.on('click', (event)=>
      @removeMsg($msg)
    )
    @

  ###
  # Add message to DOM and animate
  #
  # @param {Object} $msg - jQuery element
  #
  # @return {Object} $msg
  ###
  addMsg: ($msg)->
    area = $('#dev-panel .message-container')
    area.prepend($msg)

    TweenMax.from($msg, .3, {x: "-100%", ease: Back.easeOut}).eventCallback('onComplete', =>
      # Remove message again after timeout
      setTimeout(=>
        @removeMsg($msg)
      , @showTime)
    )
    return $msg

  ###
  # Remove message fr0m dom
  #
  # @param {Object} $msg - jQuery element
  #
  # @return {Object} $msg
  ###
  removeMsg: ($msg)->
    TweenMax.to($msg, .3, {x: "-100%", ease: Back.easeOut}).eventCallback('onComplete', =>
      $msg.remove()
    )
    return $msg




###
# Core Ajax Object
#
#
###
class DevPanelAjax
  ###
  # Constructor
  #
  # @param {Object} ajaxOpt - jQuery ajax options
  # @param {Object} options
  # @param {Object} respObj - Object to handle the ajax response
  #
  # @return {DevPanelAjax}
  ###
  constructor: (@ajaxOpt, options, respObj)->
    @options = options || {}
    @respObj = respObj || new DevPanelMsgObj()
    @devpanel = $('#dev-panel')
    @


  ###
  # Send Ajax request
  #
  # @return {Object}
  ###
  send: ->
    if @inProgress
      return

    ajaxOpt = @ajaxOpt

    ajaxOpt.beforeSend  = @ajaxOpt.beforeSend || @beforeSend
    ajaxOpt.success     = @ajaxOpt.success    || @success
    ajaxOpt.error       = @ajaxOpt.error      || @error

    if typeof ajaxOpt.url == 'undefined'
      throw "No URL defined for AJAX call."

    $.ajax(ajaxOpt)

  ###
  # Flag for if ajax is in progress
  #
  # @var {Boolean}
  ###
  inProgress: false


  ###
  # Before AJAX send
  # Set loading classes etc.
  #
  # @return {DevPanelAjax}
  ###
  beforeSend: =>
    @inProgress = true

    @devpanel.addClass 'devpanel-loading'
    if typeof @options.element != 'undefined'
      $(@options.element).addClass 'devpanel-loading'

    @

  ###
  # Success callback from AJAX request
  #
  # @param {Object} resp    - JSON response
  # @param {String} status
  # @param {Object} jqXHR
  #
  # @return {DevPanelAjax}
  ###
  success: (resp, status, jqXHR)=>
    @respObj.handle(resp)

    @devpanel.removeClass 'devpanel-loading'
    if typeof @options.element != 'undefined'
      $(@options.element).removeClass 'devpanel-loading'

    @inProgress = false

    @

