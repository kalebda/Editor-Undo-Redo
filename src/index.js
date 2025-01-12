import VanillaCaret from "vanilla-caret-js"
import Observer from "./observer"

/**
 * Undo/Redo feature for Editor.js.
 *
 * @typedef {Object} Undo
 * @description Feature's initialization class.
 * @property {Object} editor — Editor.js instance object.
 * @property {Number} maxLength - Max amount of changes recorded by the history stack.
 * @property {Function} onUpdate - Callback called when the user performs an undo or redo action.
 * @property {Boolean} shouldSaveHistory - Defines if the plugin should save the change in the stack
 * @property {Object} initialItem - Initial data object.
 */
export default class Undo {
  /**
   * @param options — Plugin custom options.
   */
  constructor({ editor, config = {}, onUpdate, maxLength }) {
    const defaultOptions = {
      maxLength: 30,
      onUpdate() {},
      config: {
        debounceTimer: 200,
      },
    }

    const { blocks, caret } = editor
    const { configuration } = editor
    const { holder, defaultBlock } = configuration
    const defaultShortcuts = defaultOptions.config.shortcuts
    const { shortcuts: configShortcuts } = config
    const shortcuts = { ...defaultShortcuts, ...configShortcuts }
    const undo = Array.isArray(shortcuts.undo)
      ? shortcuts.undo
      : [shortcuts.undo]
    const redo = Array.isArray(shortcuts.redo)
      ? shortcuts.redo
      : [shortcuts.redo]
    const defaultDebounceTimer = defaultOptions.config.debounceTimer
    const { debounceTimer = defaultDebounceTimer } = config

    this.holder =
      typeof holder === "string" ? document.getElementById(holder) : holder
    this.editor = editor
    this.defaultBlock = defaultBlock
    this.blocks = blocks
    this.caret = caret
    this.shouldSaveHistory = true
    this.readOnly = configuration.readOnly
    this.maxLength = maxLength || defaultOptions.maxLength
    this.onUpdate = onUpdate || defaultOptions.onUpdate
    this.config = { debounceTimer, shortcuts: { undo, redo } }

    const observer = new Observer(
      () => this.registerChange(),
      this.holder,
      this.config.debounceTimer
    )
    observer.setMutationObserver()

    this.initialItem = null
    this.clear()
  }

  /**
   * Notify core that read-only mode is suppoorted
   *
   * @returns {boolean}
   */
  static get isReadOnlySupported() {
    return true
  }

  /**
   * Truncates the history stack when it excedes the limit of changes.
   *
   * @param {Object} stack  Changes history stack.
   * @param {Number} stack  Limit of changes recorded by the history stack.
   */
  truncate(stack, limit) {
    while (stack.length > limit) {
      stack.shift()
    }
  }

  /**
   * Initializes the stack when the user provides initial data.
   *
   * @param {Object} initialItem  Initial data provided by the user.
   */
  initialize(initialItem) {
    const initialData =
      "blocks" in initialItem ? initialItem.blocks : initialItem
    const initialIndex = initialData.length - 1
    const firstElement = { index: initialIndex, state: initialData }
    this.stack[0] = firstElement
    this.initialItem = firstElement
  }

  /**
   * Clears the history stack.
   */
  clear() {
    this.stack = this.initialItem
      ? [this.initialItem]
      : [{ index: 0, state: [{ type: this.defaultBlock, data: {} }] }]
    this.position = 0
    this.onUpdate()
  }

  /**
   * Returns true if readOnly was toggled to true
   * @returns {Node} Indirectly shows if readOnly was set to true or false
   */
  setReadOnly() {
    const toolbox = this.holder.querySelector(".ce-toolbox")
    this.readOnly = !toolbox
  }

  /**
   * Registers the data returned by API's save method into the history stack.
   */
  registerChange() {
    this.setReadOnly()
    if (!this.readOnly) {
      if (this.editor && this.editor.save && this.shouldSaveHistory) {
        this.editor.save().then((savedData) => {
          if (this.editorDidUpdate(savedData.blocks))
            this.save(savedData.blocks)
        })
      }
      this.shouldSaveHistory = true
    }
  }

  /**
   * Checks if the saved data has to be added to the history stack.
   *
   * @param {Object} newData  New data to be saved in the history stack.
   * @returns {Boolean}
   */
  editorDidUpdate(newData) {
    const { state } = this.stack[this.position]
    if (!newData.length) return false
    if (newData.length !== state.length) return true

    return JSON.stringify(state) !== JSON.stringify(newData)
  }

  /**
   * Adds the saved data in the history stack and updates current position.
   */
  save(state) {
    if (this.position >= this.maxLength) {
      this.truncate(this.stack, this.maxLength)
    }
    this.position = Math.min(this.position, this.stack.length - 1)

    this.stack = this.stack.slice(0, this.position + 1)

    const index = this.blocks.getCurrentBlockIndex()
    const blockCount = this.blocks.getBlocksCount()
    let indexInState = index

    if (!state[index]) indexInState -= blockCount - state.length
    const caretIndex =
      state[indexInState] &&
      (state[indexInState].type === "paragraph" ||
        state[indexInState].type === "header")
        ? this.getCaretIndex(index)
        : null
    this.stack.push({ index: indexInState, state, caretIndex })
    this.position += 1
    this.onUpdate()
  }

  /**
   * Gets the caret position.
   * @param {Number} index is the block index
   * @returns The caret position
   */
  getCaretIndex(index) {
    const blocks = this.holder.getElementsByClassName("ce-block__content")
    const caretBlock = new VanillaCaret(blocks[index].firstChild)

    return caretBlock.getPos()
  }

  /**
   * Inserts a block deleted previously
   * @param {Array} state is the current state according to this.position.
   * @param {Array} compState is the state to compare and know the deleted block.
   * @param {Number} index is the block index in state.
   */
  insertDeletedBlock(state, compState, index) {
    for (let i = 0; i < state.length; i += 1) {
      if (!compState[i] || state[i].id !== compState[i].id) {
        this.blocks.insert(state[i].type, state[i].data, {}, i, true)
        this.caret.setToBlock(index, "end")
        break
      }
    }
  }

  /**
   * Returns true if a block was dropped previously
   * @param {Array} state is the current state according to this.position.
   * @param {Array} compState is the state to compare and know the dropped block.
   * @returns {Boolean} true if the block was dropped
   */
  blockWasDropped(state, compState) {
    if (state.length === compState.length) {
      return state.some((block, i) => block.id !== compState[i].id)
    }
    return false
  }

  /**
   * Returns true if the block has to be deleted because it was skipped previously.
   * @param {Array} state is the current state according to this.position.
   * @param {Array} compState is the state to compare if there was a deleted block.
   * @returns {Boolean} true if a block was inserted previously.
   */
  blockWasSkipped(state, compState) {
    return state.length !== compState.length
  }

  /**
   * Returns true if the content in a block without the focus was modified.
   * @param {Number} index is the block index in state.
   * @param {Number} compIndex is the index to compare and know if the block was inserted previously
   * @returns true if the content in a block without the focus was modified.
   */
  contentChangedInNoFocusBlock(index, compIndex) {
    return index !== compIndex
  }

  /**
   * Returns true if a block was deleted previously.
   * @param {Array} state is the current state according to this.position.
   * @param {Array} compState is the state to compare and know if a block was deleted.
   * @returns {Boolean} true if a block was deleted previously.
   */
  blockWasDeleted(state, compState) {
    return state.length > compState.length
  }

  /**
   * Returns true if the content was copied.
   * @param {Array} state is the current state according to this.position.
   * @param {Array} compState is the state to compare and know if the content was copied.
   * @param {Number} index is the block index in state.
   * @returns {Boolean} true if a block was deleted previously.
   */
  contentWasCopied(state, compState, index) {
    return (
      Object.keys(state[index].data).length === 0 &&
      JSON.stringify(compState[index + 1]) !== JSON.stringify(state[index + 1])
    )
  }

  /**
   * Decreases the current position and update the respective block in the editor.
   */
  async undo() {
    if (this.canUndo()) {
      const { index: nextIndex, state: nextState } = this.stack[this.position]

      this.position -= 1
      this.shouldSaveHistory = false
      let { index } = this.stack[this.position]
      const { state, caretIndex } = this.stack[this.position]

      this.onUpdate()
      const blockCount = this.blocks.getBlocksCount()

      if (!state[index]) {
        index -= 1
        this.stack[this.position].index = index
      }

      if (this.blockWasDeleted(state, nextState)) {
        this.insertDeletedBlock(state, nextState, index)
      } else if (this.contentWasCopied(state, nextState, index)) {
        await this.blocks.render({ blocks: state }, true)
        this.caret.setToBlock(index, "end")
      } else if (index < nextIndex && this.blockWasSkipped(state, nextState)) {
        await this.blocks.delete(nextIndex)
        this.caret.setToBlock(index, "end")
      } else if (blockCount > state.length) {
        await this.blocks.render({ blocks: state }, true)
        this.setCaretIndex(index, caretIndex)
      } else if (this.blockWasDropped(state, nextState)) {
        await this.blocks.render({ blocks: state }, true)
        this.caret.setToBlock(index, "end")
      } else if (this.contentChangedInNoFocusBlock(index, nextIndex)) {
        const { id } = this.blocks.getBlockByIndex(nextIndex)
        await this.blocks.update(id, state[nextIndex].data)
        this.setCaretIndex(index, caretIndex)
      }
      const block = this.blocks.getBlockByIndex(index)
      if (block) {
        await this.blocks.update(block.id, state[index].data)
        this.setCaretIndex(index, caretIndex)
      }
    }
  }

  /**
   * Sets the caret position.
   * @param {Number} index is the block index
   * @param {Number} caretIndex is the caret position
   * @param {Array} state is the current state according to this.position.
   */
  setCaretIndex(index, caretIndex) {
    if (caretIndex && caretIndex !== -1) {
      const blocks = this.holder.getElementsByClassName("ce-block__content")
      const caretBlock = new VanillaCaret(blocks[index].firstChild)
      setTimeout(() => caretBlock.setPos(caretIndex), 50)
    } else {
      this.caret.setToBlock(index, "end")
    }
  }

  /**
   * Inserts new block
   * @param {Array} state is the current state according to this.position.
   * @param {Number} index is the block index
   */
  async insertBlock(state, index) {
    await this.blocks.insert(
      state[index].type,
      state[index].data,
      {},
      index,
      true
    )
  }

  /**
   * Inserts a block when is skipped and update the previous one if it changed.
   * @param {Array} prevState is the previous state according to this.position.
   * @param {Array} state is the current state according to this.position.
   * @param {Number} index is the block index.
   */
  async insertSkippedBlocks(prevState, state, index) {
    for (let i = prevState.length; i < state.length; i += 1) {
      this.insertBlock(state, i)
    }

    if (
      JSON.stringify(prevState[index - 1]) !== JSON.stringify(state[index - 1])
    ) {
      await this.updateModifiedBlock(state, index)
    }
  }

  /**
   * Updates the passed block or render the state when the content was copied.
   * @param {Array} state is the current state according to this.position.
   * @param {Number} index is the block index.
   */
  async updateModifiedBlock(state, index) {
    const block = state[index - 1]
    if (this.editor.blocks.getById(block.id))
      return this.blocks.update(block.id, block.data)
    return this.blocks.render({ blocks: state }, true)
  }

  /**
   * Increases the current position and update the respective block in the editor.
   */
  async redo() {
    if (this.canRedo()) {
      this.position += 1
      this.shouldSaveHistory = false
      const { index, state, caretIndex } = this.stack[this.position]
      const { index: prevIndex, state: prevState } =
        this.stack[this.position - 1]

      if (this.blockWasDeleted(prevState, state)) {
        // Find the index of the block that was deleted
        const deletedIndex = prevState.findIndex(
          (block, i) =>
            !state.some((stateBlock) => stateBlock.id === block.id) ||
            (state[i] && state[i].id !== block.id)
        )

        if (deletedIndex !== -1) {
          await this.blocks.delete(deletedIndex)
          // Set caret to the block after the deleted one, or the last block if we deleted the last one
          const newIndex = Math.min(deletedIndex, state.length - 1)
          this.caret.setToBlock(newIndex, "end")
        }
      } else if (this.blockWasSkipped(state, prevState)) {
        await this.insertSkippedBlocks(prevState, state, index)
        this.caret.setToBlock(index, "end")
      } else if (
        this.blockWasDropped(state, prevState) &&
        this.position !== 1
      ) {
        await this.blocks.render({ blocks: state }, true)
        this.caret.setToBlock(index, "end")
      }
      this.onUpdate()
      const block = this.blocks.getBlockByIndex(index)
      if (block) {
        await this.blocks.update(block.id, state[index].data)
        this.setCaretIndex(index, caretIndex)
      }
    }
  }

  /**
   * Checks if the history stack can perform an undo action.
   *
   * @returns {Boolean}
   */
  canUndo() {
    return !this.readOnly && this.position > 0
  }

  /**
   * Checks if the history stack can perform a redo action.
   *
   * @returns {Boolean}
   */
  canRedo() {
    return !this.readOnly && this.position < this.count()
  }

  /**
   * Returns the number of changes recorded in the history stack.
   *
   * @returns {Number}
   */
  count() {
    return this.stack.length - 1 // -1 because of initial item
  }

  /**
   * Parses the keys passed in the shortcut property to accept CMD,ALT and SHIFT
   *
   * @param {Array} keys are the keys passed in shortcuts in config
   * @returns {Array}
   */

  parseKeys(keys) {
    const specialKeys = {
      CMD: /(Mac)/i.test(navigator.platform) ? "metaKey" : "ctrlKey",
      ALT: "altKey",
      SHIFT: "shiftKey",
    }
    const parsedKeys = keys.slice(0, -1).map((key) => specialKeys[key])

    const letterKey =
      parsedKeys.includes("shiftKey") && keys.length === 2
        ? keys[keys.length - 1].toUpperCase()
        : keys[keys.length - 1].toLowerCase()

    parsedKeys.push(letterKey)
    return parsedKeys
  }

  // Public method to perform undo action
  performUndo() {
    if (this.canUndo()) {
      this.undo()
    }
  }

  // Public method to perform redo action
  performRedo() {
    if (this.canRedo()) {
      this.redo()
    }
  }

  // Public method to check if undo is available
  isUndoAvailable() {
    return this.canUndo()
  }

  // Public method to check if redo is available
  isRedoAvailable() {
    return this.canRedo()
  }
}
