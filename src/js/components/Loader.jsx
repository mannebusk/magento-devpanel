/**
 * Global Loader Bar
 *
 * @author Manne Busk <mannebusk@gmail.com>
 */
import React          from 'react';
import ReactDOM       from 'react-dom';

let Loader = React.createClass({

  /**
   * Start animation when compoenent is mounted
   */
  componentDidMount: function() {
    this.animate();
  },

  /**
   * Get initial state for component
   *
   * @return {Object}
   */
  getInitialState: function() {
    return {
      progress: 0
    };
  },

  animate: function() {
    let animationFrameID = requestAnimationFrame(this.animate);

    let changeRate = (100 - this.state.progress) / 100;

    // If we finnished early with loading, speed up the progress to finish
    if (this.props.done) {
      changeRate = Math.ceil((100 - this.state.progress) / 10);
    }

    if (this.state.progress < 100) {
      this.setState({
        progress: this.state.progress + changeRate
      });
    } else {
      // Progress is at 100% and we are all finished
      cancelAnimationFrame(animationFrameID);
      setTimeout(function() {
        this.props.doneCallback();
      }.bind(this), 200);
    }
  },

  /**
   * Get style for inner loader bar
   *
   * @return {Object}
   */
  getInnerStyle: function() {
    let progress = this.state.progress;

    return {
      width: progress + "%"
    };
  },

  /**
   * Render Component
   *
   * @return {ReactElement}
   */
  render: function() {
    return (
      <div className="dp-loader">
        <span className="dp-inner-bar" style={this.getInnerStyle()}></span>
      </div>
    );
  }
});

export default Loader;
