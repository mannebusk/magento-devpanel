/**
 * Menu
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React      from 'react';
import ReactDOM   from 'react-dom';
import IconMixin  from 'mixins/IconMixin.jsx';

let Menu = React.createClass({

  mixins: [IconMixin],

  /**
   * Render Component
   *
   * @return ReactElement
   */
  render: function() {
    return (
      <div className="dp-menu">
        <ul>
          <li>
            <a href="#">
              {this.getIcon(require('icon/layers.svg'))}
              Layout Debuger
            </a>
          </li>
          <li>
            <a href="#">
              {this.getIcon(require('icon/person.svg'))}
              Accounts
            </a>
          </li>
          <li>
            <a href="#">
              {this.getIcon(require('icon/flash.svg'))}
              Cache
            </a>
          </li>
          <li>
            <a href="#">
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
