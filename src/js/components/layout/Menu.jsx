/**
 * Menu
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React      from 'react';
import ReactDOM   from 'react-dom';
import IconMixin  from 'mixins/IconMixin.jsx';
import { goToRoute, closeMenu, setTitle }  from 'actions';

let Menu = React.createClass({

  /**
   * Mixins
   *
   * @var {Array}
   */
  mixins: [IconMixin],

  /**
   * Transition to a route on menu item click
   *
   * @param {String} route
   */
  goTo: function(route, title) {
    this.props.dispatch(goToRoute(route));
    this.props.dispatch(setTitle(title));
    this.props.dispatch(closeMenu());
  },

  /**
   * Render Component
   *
   * @return {ReactElement}
   */
  render: function() {
    return (
      <div className="dp-menu">
        <ul>
          <li>
            <a href="#" onClick={this.goTo.bind(this, 'layout', 'Layout Debuger')}>
              {this.getIcon(require('icon/layers.svg'))}
              Layout Debuger
            </a>
          </li>
          <li>
            <a href="#" onClick={this.goTo.bind(this, 'accounts', 'Accounts')}>
              {this.getIcon(require('icon/person.svg'))}
              Accounts
            </a>
          </li>
          <li>
            <a href="#" onClick={this.goTo.bind(this, 'cache', 'Cache')}>
              {this.getIcon(require('icon/flash.svg'))}
              Cache
            </a>
          </li>
          <li>
            <a href="#" onClick={this.goTo.bind(this, 'configuration', 'Config XML')}>
              {this.getIcon(require('icon/code.svg'))}
              Configuration XML
            </a>
          </li>
        </ul>
      </div>
    );
  }
});

export default Menu;

/**
 * Open and close animations
 *
 * @var {Obejct}
 */
export let menuAnimation = {
  open: {
    animation: {
      rotateY: 0,
      translateX: 0,
      translateZ: 0,
      transformOrigin: ["20%", "center"]
    },
    easing: "ease-out",
    duration: 250
  },
  close: {
    animation: {
      rotateY: -90,
      translateX: "-10rem",
      translateZ: 0,
      transformOrigin: 0
    },
    easing: "ease-in",
    duration: 250
  }
};
