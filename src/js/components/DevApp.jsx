/**
 * Dev Application Controller View
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React      from 'react';
import ReactDOM   from 'react-dom';
import IconMixin  from 'mixins/IconMixin.jsx';

let DevApp = React.createClass({

  mixins: [IconMixin],

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
          <button className="dp-button">
            {this.getIcon(require('icon/menu.svg'))}
          </button>
        </div>
        <div
          className="dp-content"
        >
        </div>
      </div>
    );
  }
});

export default DevApp;