import React, { Component } from 'react';
import measure from '../Sketches/measure';
import P5Wrapper from 'react-p5-wrapper';


class Measure extends Component {

    constructor(props) {
        super(props)
        this.state = {
            start: props.start,
            end: props.end,
            beats: props.beats,
            PPQ: props.PPQ
        }

        let ticks = props.PPQ * props.beats;
        let cumulative = 0.0;
        let inc = (props.end-props.start)/ticks;
        for (var i=0; i<ticks; i++) {
            cumulative += (60000.0/(props.start + inc*i))/props.PPQ;
        }

        this.state.len = cumulative;
        console.log(cumulative);
    }

    render() {
        console.log({
            scope: window.innerWidth,
            sizing: this.props.sizing
        });
        return (
            <P5Wrapper sketch={measure} start={this.state.start} end={this.state.end} beats={this.state.beats} PPQ={this.state.PPQ} sizing={this.props.sizing} scope={window.innerWidth}/>
        )
    }
}

export default Measure;
