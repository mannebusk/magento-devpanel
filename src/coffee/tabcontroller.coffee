###
# Tab Controller
#
# @author Manne Busk <mannebusk@gmail.com>
###
$ = jQuery.noConflict()

class TabController
  ###
  # Constructor
  #
  # @param {Object} controller  - jQuery element
  # @param {Object} config      - General settings
  #
  # @return {WhCore}
  ###
  constructor: (@controller, @config)->
    @ns             = @controller.attr('data-tabcontroller')
    @tabSel         = '[data-' + @ns + '-tab]'
    @tabContentSel  = '[data-' + @ns + '-tabcontent]'
    @activeSel      = '[data-' + @ns + '-tab].active'

    $(@tabContentSel).hide()
    @loadState()

    @controller.find(@tabSel + ' a').on('click', ((event)->
      tab = $(event.target).closest(@tabSel)
      @changeTab(tab)
    ).bind(@))

  ###
  # Change tab to view
  #
  # @param {Object} tab - jQuery element
  #
  # @return {WhCore}
  ###
  changeTab: (tab)->
    prevContent = @getContentForTab($(@activeSel))
    content = @getContentForTab(tab)
    @controller.find(@tabSel).removeClass('active')
    tab.addClass('active')

    hide =
      opacity: 0
    show =
      opacity: 1

    prevAnim = TweenMax.fromTo(prevContent, 0.1, show, hide)
    prevAnim.eventCallback('onComplete', ->
      prevContent.removeAttr('style').hide()
    )
    currentAnim = TweenMax.fromTo(content, 0.1, hide, show)
    currentAnim.eventCallback('onComplete', ->
      content.removeAttr('style')
    )
    @saveState()
    @

  ###
  # Get content element asociated with tab
  #
  # @param {Object} tab - jQuery element
  #
  # @return {Object}
  ###
  getContentForTab: (tab)->
    id = tab.attr(@tabSel.replace('[', '').replace(']', ''))
    str = '="' + id + '"]'
    return $(@tabContentSel.replace(']', str))

  ###
  # Save state to localstorage
  #
  # @return {Object}
  ###
  saveState: ->
    state =
      active: @controller.find(@activeSel).attr(@tabSel.replace('[', '').replace(']', ''))
    localStorage.setItem('devpanel.tabs.' + @ns, JSON.stringify(state))
    @

  ###
  # Load state from localstorage
  #
  # @return {Object}
  ###
  loadState: ->
    state = JSON.parse(localStorage.getItem('devpanel.tabs.' + @ns))
    if state and state.active
      tab = @controller.find(@tabSel.replace(']', '="' + state.active + '"]'))
    else
      tab = @controller.find(@activeSel)

    @changeTab(tab)
    @




###
# jQuery Plugin
#
###
$.fn.tabController = (options)->
  options = options || {}
  $(@).each(->
    $(@).data('TabController', new TabController($(@)), options)
  )
