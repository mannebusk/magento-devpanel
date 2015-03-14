###
# Prototype for Arrays filter function.
# Needs to be reset as Prototype library overrides this one.
###
Array.prototype.filter = (fun)->
  'use strict'
  if this == 0 || this == null
    throw new TypeError()

  t = Object(this)
  len = t.length >>> 0
  if typeof fun != 'function'
    throw new TypeError()

  res = []

  if arguments.length >= 2
    thisArg = arguments[1]
  else
    thisArg = 0

  for i in t.length
    if i in t
      val = t[i]

      ###
      // NOTE: Technically this should Object.defineProperty at
      //       the next index, as push can be affected by
      //       properties on Object.prototype and Array.prototype.
      //       But that method's new, and collisions should be
      //       rare, so use the more-compatible alternative.
      ###
      if fun.call(thisArg, val, i, t)
        res.push(val)
  return res




###
# Main Coffeescript file. Initializes stuff when DOM is ready.
#
# @author Manne Busk <mannebusk@gmail.com>
###
$ = jQuery.noConflict()

$(->
  $('[data-tabcontroller]').tabController()

  ###
  # List Searches
  ###
  blockSearch         = new DevPanelList('block-info-list', ['name', 'class', 'template'], 'block-info-search')
  handleSearch        = new DevPanelList('layout-handle-list', ['handle'], 'layout-handle-search')
  storeSearch         = new DevPanelList('store-list', ['website', 'store', 'code', 'id', 'store-id', 'store-code'], 'store-search')
  userFrontend        = new DevPanelList('frontend-login-list', ['name', 'email'], 'user-frontend-input')
  userAdmin           = new DevPanelList('admin-login-list', ['name', 'email'], 'user-admin-input')

  ###
  # Block hints
  ###
  blockHints = new BlockHints(
    searchObj: blockSearch
  )

  ###
  # Clear Cache
  ###
  $('[data-devpanel-ajax]').on('click', (event)=>
    event.preventDefault()
    options =
      url: $(event.target).attr('href')
    ajax = new DevPanelAjax(options).send()
  )

  ###
  # Config XML Viewer
  ###
  xmlViewer = new DevPanelXmlViewer
)
