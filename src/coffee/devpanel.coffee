###
# Dev Panel Core Object
#
# @author Manne Busk <mannebusk@gmail.com>
###
$ = jQuery.noConflict()

class DevPanel
  ###
  # Constructor
  #
  # @return {WhCore}
  ###
  constructor: (@config)->
    @panel = '#dev-panel'
    that = @

    $(@panel).on('click', '.toggle', (event)->
      event.preventDefault()
      that.togglePanel()
    )

    @load()

    @initAutofill()
    @injectSvgs()
    @

  ###
  # Toggle panel
  #
  # @return {WhCore}
  ###
  togglePanel: ->
    if $(@panel).hasClass 'closed'
      @open()
    else
      @close()
    @

  ###
  # Open Panel
  #
  # @return {WhCore}
  ###
  open: ->
    that = @
    to =
      y: 0

    btn = $(@panel).find('.toggle')

    tw = TweenMax.to(btn, 0.1, {y: btn.outerHeight()})
    tw.eventCallback('onComplete', =>
      btn.removeAttr('style')
    )

    tween = TweenMax.to($(@panel), 0.2, to)
    tween.eventCallback('onComplete', ->
      $(that.panel).removeClass('closed').removeAttr('style')
      btn.removeAttr('style')
      that.save()
    )
    @

  ###
  # Close Panel
  #
  # @return {WhCore}
  ###
  close: ->
    that = @
    height = $(window).height() / 2
    to =
      y: height

    btn = $(@panel).find('.toggle')
    TweenMax.to(btn, 0.2, {y: 0}).eventCallback('onComplete', =>
      btn.removeAttr('style')
    )

    tween = TweenMax.to($(@panel), 0.2, to)
    tween.eventCallback('onComplete', ->
      $(that.panel).addClass('closed').removeAttr('style')
      that.save()
    )
    @

  ###
  # Set up autofill for forms
  #
  # @return {WhCore}
  ###
  initAutofill: ->
    @autoFill = new AutoFill(@, @config.formAutoFill)
    @

  ###
  # Save panel state to localstorage
  #
  # @return {WhCore}
  ###
  save: ->
    open = false
    if $(@panel).hasClass 'closed'
      open = false
    else
      open = true

    state =
      open: open

    localStorage.setItem('devpanel', JSON.stringify(state))
    @

  ###
  # Load panel state from localstorage
  #
  # @return {WhCore}
  ###
  load: ->
    state = JSON.parse(localStorage.getItem('devpanel'))
    if not state
      return

    if state.open
      @open()
    else
      @close()
    @

  ###
  # Inject Inline SVG's
  ###
  injectSvgs: ->
    svgs = document.querySelectorAll('img.dpsvg')
    SVGInjector(svgs)
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

window.DevPanel = DevPanel
