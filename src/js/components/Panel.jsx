/**
 * Panel js
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React      from 'react';
import ReactDOM   from 'react-dom';

var Panel = React.createClass({

  componentDidMount: function() {
    document.addEventListener('mousemove', this.toggleSneakPeak);
    document.addEventListener('click', this.outsideClickHandler);
  },

  componentWillUnmount: function() {
    document.removeEventListener(this.toggleSneakPeak);
    document.removeEventListener(this.outsideClickHandler);
  },

  /**
   * Handle mouse move event and toggle sneakPeak if near left edge of viewport
   *
   * @param MouseEvent e
   */
  toggleSneakPeak: function(e) {
    let padding = 50;
    let el = this.refs.panel;

    if (!this.state.sneakPeak && e.x <= padding) {
      this.setState({sneakPeak: true});
    } else if (this.state.sneakPeak && e.x > padding) {
      this.setState({sneakPeak: false});
    }
  },

  /**
   * Handle Clicks and close panel if click is outside
   *
   * @param MouseEvent e
   */
  outsideClickHandler: function(e) {
    let clicked = e.target;
    let panel   = this.refs.panel;
    let posNum  = panel.compareDocumentPosition(clicked);

    if (posNum <= 10 && posNum !== 0) {
      e.preventDefault();
      this.setState({open: false});
    }
  },

  /**
   * Get the initial state
   *
   * @return {Object}
   */
  getInitialState: function() {
    return {
      sneakPeak: false,
      open: false
    };
  },

  /**
   * Render Component
   *
   * @return ReactElement
   */
  render: function() {
    let classNames = ["dev-panel"];

    if (this.state.open) {
      classNames.push('open');
    } else if (this.state.sneakPeak) {
      classNames.push('sneak-peak');
    }

    return (
      <div
        className={classNames.join(" ")}
        ref="panel"
        id="dev-panel"
      >
        <h1>Dev Panel</h1>
        <div
          className="sneaker"
          onClick={this.open}
        >
        </div>
      </div>
    );
  },

  open: function() {
    this.setState({open: true})
  }
});

export default Panel;
