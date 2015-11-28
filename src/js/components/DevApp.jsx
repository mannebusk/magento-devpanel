/**
 * Dev Application Controller View
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React          from 'react';
import ReactDOM       from 'react-dom';
import { connect }    from 'react-redux';

import IconMixin      from 'mixins/IconMixin.jsx';
import Router         from 'components/Router.jsx';
import Menu,
  { menuAnimation }   from 'components/layout/Menu.jsx';

import {
  VelocityTransitionGroup
} from 'velocity-react';

import {
  openMenu,
  closeMenu
} from 'actions';

let DevApp = React.createClass({

  mixins: [IconMixin],

  /**
   * Toggle menu open
   */
  toggleMenu: function() {
    if (this.props.panel.showMenu) {
      this.props.dispatch(closeMenu());
    } else {
      this.props.dispatch(openMenu());
    }
  },

  /**
   * Render Menu Component
   *
   * @return ReactElement
   */
  renderMenu: function() {
    if (!this.props.panel.showMenu) {
      return null;
    }

    return (
      <Menu
        dispatch={this.props.dispatch}
        current={this.props.route}
      />
    );
  },

  /**
   * Render Component
   *
   * @return ReactElement
   */
  render: function() {
    return (
      <div>
        <div
          className="dp-header"
        >
          <span className="dp-app-title">
            <span>DevPanel</span>
          </span>
          <button className="dp-button" onClick={this.toggleMenu}>
            {this.getIcon(require('icon/menu.svg'))}
          </button>
        </div>
        <VelocityTransitionGroup
          enter={menuAnimation.open}
          leave={menuAnimation.close}
        >
          {this.renderMenu()}
        </VelocityTransitionGroup>
        <Router {...this.props}/>
      </div>
    );
  }
});

/**
 * Select part of global state to be visible to component
 *
 * @param {Object} state
 * @return {Object}
 */
function select(state) {
  return state;
}

export default connect(select)(DevApp);
