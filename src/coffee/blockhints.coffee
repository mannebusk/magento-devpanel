###
# Block Hint Object
#
# @author Manne Busk
###
class BlockHints
  ###
  # Contstructor
  #
  # @param {Object} options
  #
  # @return {BlockHints}
  ###
  constructor: (@options)->
    @blockExp         = /^[\s]*block:[^\s]+[\s]*$/
    @blockNameExp     = /^[\s]*block:([^\s]+)[\s]*$/
    @blockEndExp      = /^[\s]*#block:[^\s]+[\s]*$/
    @blockEndNameExp  = /^[\s]*#block:([^\s]+)[\s]*$/

    @hintActive       = 'data-block-hint-active'
    @hintHover        = 'data-block-hint-hover'

    @comments = @getComments(document.querySelector('body'))
    @registerEvents()
    @

  ###
  # Register event listeners
  #
  # @return {BlockHints}
  ###
  registerEvents: ->

    # Highlight by clicking on block in list
    $('#block-info-list').on('click', 'li', (event)=>
      that = @

      item = $(event.target)
      if not item.is('li')
        item = item.closest('li')

      if not item.find('.template').length
        return

      name = item.find('.name').text()
      blockEls = @getBlockElements(name)

      active = item.attr(that.hintActive)

      $(blockEls).each(->
        if typeof active == 'undefined' or active == false
          $(@).attr(that.hintActive, "")
          item.attr(that.hintActive, "")
        else
          $(@).removeAttr(that.hintActive)
          item.removeAttr(that.hintActive)
      )
    )

    # Toggle hover hints
    $('[data-toggle-hints]').on('click', (event)=>
      if not @hintsOn
        @onBlockHints()
      else
        @offBlockHints()
    )

    $('[data-hints-off]').on('click', =>
      @offBlockHints()
      $('[' + @hintActive + ']').removeAttr(@hintActive)
      $('[' + @hintHover + ']').removeAttr(@hintHover)
    )
    @

  ###
  # Block Hints Enabled
  #
  # @var {Boolean}
  ###
  hintsOn: false

  ###
  # Turn on block hints
  #
  # @return {BlockHints}
  ###
  onBlockHints: ->
    @hintsOn = true
    $('[' + @hintActive + ']').removeAttr(@hintActive)
    $('[' + @hintHover + ']').removeAttr(@hintHover)
    $('[data-toggle-hints]').addClass 'active'
    for own name, comment of @comments
      blockEls = @getBlockElements(name)
      for el in blockEls
        if $(el).parents('#dev-panel').length or $(el).get(0) == $('#dev-panel')
          return

        $(el).attr('data-block-name', name)
        $(el).on('mouseenter.blockhints', (event)=>

          $('[' + @hintHover + ']').removeAttr(@hintHover)
          block = $(event.target).closest('[data-block-name]')
          block.attr(@hintHover, "")

          # Click on hovered element
          $(event.target).on('click.hoverhint', (event)=>
            if not @hintsOn
              return
            event.preventDefault()
            event.stopPropagation()

            block = $(event.target)
            isIt = block.attr('data-block-name')
            if typeof isIt == 'undefined' or isIt == false
              block = block.closest('[data-block-name]')
            name = block.attr('data-block-name')

            @options.searchObj.search(name, ['name'])
            block.attr(@hintActive, "")
            $('#block-info-list ul li').first()
              .attr(@hintActive, "")
            $('.block-info-search').val(name)
            @offBlockHints()
          )
        )
        $(el).on('mouseleave.blockhints', (event)=>
          block = $(event.target).closest('[data-block-name]')
          block.removeAttr(@hintHover)
          block.off('.hoverhint')
        )
    @

  ###
  # Turn off block hints
  #
  # @return {BlockHints}
  ###
  offBlockHints: ->
    @hintsOn = false
    $('[' + @hintHover + ']').removeAttr(@hintHover)
    $('[data-toggle-hints]').removeClass 'active'
    for own name, comment of @comments
      blockEls = @getBlockElements(name)
      for el in blockEls
        if $(el).parents('#dev-panel').length or $(el).get(0) == $('#dev-panel')
          return
        $(el).off('.blockhints')
        $(el).off('.hoverhint')



  ###
  # Get all html nodes between the comment nodes
  # for the specified blockname
  #
  # @param {String} name - Block name
  #
  # @return {Array}
  ###
  getBlockElements: (name)->
    that = @
    arr = []
    finished = false

    getNext = (elem)->
      if not elem or finished
        return

      if elem.nodeType == 8
        if elem.nodeValue
          end = elem.nodeValue.match(that.blockEndNameExp)
          if end and end[1] == name
            finished = true
            return

      if elem.nodeType != 1
        if elem.nextSibling
          getNext(elem.nextSibling)
        else
          return

      if not finished
        arr.push(elem)
      else
        return

      if elem.nextSibling
        getNext(elem.nextSibling)
      else
        return

    if typeof @comments[name] != 'undefined'
      next = @comments[name].nextSibling
      getNext(next)
    return arr

  ###
  # Get All block comments inside element
  #
  # @param {Object} elem - Html element
  #
  # @return {Object} res
  ###
  getComments: (elem)->
    res = {}
    getNext = (elem)=>
      children = elem.childNodes
      for child in children
        if child.nodeType == 1
          continue
        if child.nodeType == 8
          name = child.nodeValue.match(@blockNameExp)
          if name
            res[name[1]] = child
          continue
        if child.childNodes
          getNext(child)
        if child.nextSibling
          getNext(child.nextSibling)
    getNext(elem)
    return res

