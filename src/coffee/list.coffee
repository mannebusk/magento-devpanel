###
# DevPanel List Object
#
###
class DevPanelList
  ###
  # Constructor
  #
  # @param {String} id          - HTML Id
  # @param {Array}  attributes  - Attributes to search in
  # @param {String} inputClass  - Class for input element
  # @param {Object} options     - General options
  #
  # @return {DevPanelList}
  ###
  constructor: (@id, @attributes, @inputClass, @options)->

    options =
      valueNames: @attributes
      searchClass: @inputClass
      plugins: [
        ListFuzzySearch()
      ]
      location: 5
      distance: 100
      threshold: 0.5
      multiSearch: true

    @list = new List(@id, options)

    @listWrapper = $('#' + @id)
    @listWrapper.on('click', '[data-search-clear]', (event)=>
      @search()
    )

    @listWrapper.find('.' + @inputClass).on('keyup', (event)=>
      @save(@listWrapper.find('.' + @inputClass).val())
    )

    @load()
    @

  ###
  # Search in list
  #
  # @param {String} string      - Search value
  # @param {Array}  attributes  - Attributes to search in
  #
  # @return {DevPanelList}
  ###
  search: (string, attributes)->
    @list.fuzzySearch.search(string, attributes)
    @listWrapper.find('.' + @inputClass).val(string)
    @save(string, attributes)
    @

  ###
  # Save List state to localstorage
  #
  # @param {String} string      - Search value
  # @param {Array}  attributes  - Attributes to search in
  #
  # @return {DevPanelList}
  ###
  save: (string, attributes)->
    attr = attributes || @attributes
    state =
      value: string
      attributes: attr

    localStorage.setItem('devpanel.search.' + @id, JSON.stringify(state))
    @

  ###
  # Load List state from localstorage
  #
  # @return {DevPanelList}
  ###
  load: ->
    state = JSON.parse(localStorage.getItem('devpanel.search.' + @id))
    if not state
      return
    @search(state.value, state.attributes)
    @

