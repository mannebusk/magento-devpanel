/**
 * Application router
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React                from 'react';
import ReactDOM             from 'react-dom';

export default React.createClass({

  /**
   * Render Component for Route
   *
   * @return ReactElement
   */
  renderRoute: function() {
    switch (this.props.route) {
      case "layout":
        return (
          <h1>Layout debuger</h1>
        );
        break;
      case "accounts":
        return (
          <h1>Accounts</h1>
        );
        break;
      case "cache":
        return (
          <h1>Cache Management</h1>
        );
        break;
      case "configuration":
        return (
          <h1>Comfiguration XML</h1>
        );
        break;
      default:
        return "";
        break;
    }
  },

  /**
   * Render Component
   *
   * @return ReactElement
   */
  render: function() {
    return (
      <div className="dp-content">
        {this.renderRoute()}
      </div>
    );
  }
});
