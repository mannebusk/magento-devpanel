/**
 * Panel js
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React                from 'react';
import ReactDOM             from 'react-dom';
import { connect }          from 'react-redux';
import IconMixin            from 'mixins/IconMixin.jsx';
import {
  openPanel,
  closePanel,
  showPanelSneakPeak,
  hidePanelSneakPeak
} from 'actions';

var Panel = React.createClass({

  /**
   * Mixins
   *
   * @var {Array}
   */
  mixins: [IconMixin],

  /**
   * On component mount
   */
  componentDidMount: function() {
    document.addEventListener('mousemove', this.toggleSneakPeak);
    document.addEventListener('click', this.outsideClickHandler);
  },

  /**
   * On component unmount
   */
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

    if (!this.props.sneakPeak && e.x <= padding) {
      this.props.dispatch(showPanelSneakPeak());
    } else if (this.props.sneakPeak && e.x > padding) {
      this.props.dispatch(hidePanelSneakPeak());
    }
  },

  /**
   * Handle Clicks and close panel if click is outside
   *
   * @param MouseEvent e
   */
  outsideClickHandler: function(e) {
    if (!this.props.open) {
      return;
    }

    let clicked = e.target;
    let panel   = this.refs.panel;
    let posNum  = panel.compareDocumentPosition(clicked);

    if (posNum <= 10 && posNum !== 0) {
      e.preventDefault();
      this.props.dispatch(closePanel());
    }
  },

  /**
   * Render Component
   *
   * @return ReactElement
   */
  render: function() {
    let classNames = ["dev-panel"];

    if (this.props.open) {
      classNames.push('open');
    } else if (this.props.sneakPeak) {
      classNames.push('sneak-peak');
    }

    return (
      <div
        className={classNames.join(" ")}
        ref="panel"
        id="dev-panel"
      >
        <div
          className="sneaker"
          onClick={this.open}
        >
          {this.getIcon(require("icon/browser.svg"))}
          <h4 className="dp-text">dev</h4>
        </div>
        {this.props.children}
      </div>
    );
  },

  open: function() {
    this.props.dispatch(openPanel());
  }
});

/**
 * Select part of global state to be visible to component
 *
 * @param {Object} state
 * @return {Object}
 */
function select(state) {
  return state.panel;
}

export default connect(select)(Panel);
