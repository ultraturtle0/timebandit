import c from '../config/CONFIG.json';
import { primary, secondary, secondary_light } from '../config/CONFIG.json';

export default (p) => {
    class _Window {
        constructor() {
            this.scale = 1.0;
            this.viewport = 0;
            this.scroll = 0;
            this.span = [Infinity, -Infinity];

            // modes: ESC, INS, EDITOR
            this.mode = 0;
            this.panels = false;
            this.selected = {
                inst: -1,
                meas: undefined
            };
            this.insts = 0;
            this.mods = {};

            this.insertMeas = {};
            this.editMeas = {};
            this._lockingCandidate = null;

            this.updateViewCallback = () => null;
        }

        /* what does a lock look like
         * {
         *  beat
         *  type
         * }
         */

        locking(candidate, beat) {
            if ('locks' in candidate) {
                // toggle off if found
                if (beat in candidate.locks) {
                    delete candidate.locks[beat];
                    return false;
                } else
                    candidate.locks[beat] = null;
            } else
                candidate.locks = { [beat]: null }
            console.log(candidate.locks);
            this._lockingCandidate = beat;
            return true;
        }

        lockConfirm(candidate, type) {
            let beat = this._lockingCandidate;
            if (!type)
                delete candidate.locks[beat]
            else if (beat !== null)
                candidate.locks[beat] = type;
            this._lockingCandidate = null;
        }

        initialize_temp() {
            this.selected.meas.temp = {
                start: this.selected.meas.start,
                end: this.selected.meas.end,
                ms: this.selected.meas.ms,
                ticks: this.selected.meas.ticks,
                beats: this.selected.meas.beats,
                offset: this.selected.meas.offset
            };
        }

        setUpdateViewCallback(cb) {
            this.updateViewCallback = cb;
        }

        updateView(event, { zoom }) {
            if (zoom) {
                let change = 1.0-event.delta/c.SCROLL_SENSITIVITY;
                this.scale *= change;
                this.viewport = p.mouseX - change*(p.mouseX - this.viewport);
            };
            this.viewport -= event.deltaX;

            let frame_height = (p.height - c.PLAYBACK_HEIGHT - c.TRACKING_HEIGHT);
            if (frame_height > this.insts*c.INST_HEIGHT) {
                this.scroll = 0;
                return;
            } else {
                this.scroll += event.deltaY;
                if (this.scroll < 0)
                    this.scroll = 0;
                if (this.scroll > this.insts*c.INST_HEIGHT - frame_height + 28 + (this.panels ? c.INST_HEIGHT : 0))
                    this.scroll = this.insts*c.INST_HEIGHT - frame_height + 28 + (this.panels ? c.INST_HEIGHT : 0);
            }

            this.updateViewCallback(this.viewport, this.scale, this.scroll);
        }

        drawPlayback() {
            // DRAW TOP BAR
            p.stroke(secondary);
            p.fill(secondary);
            p.rect(0, 0, p.width, c.PLAYBACK_HEIGHT);

            p.push();
            p.translate(c.PANES_WIDTH, 0);
            let zoom_thresholds = [0.0025, 0.01, 0.03, 0.1, 0.5, 1.0, 2.0];
            let zoom_values = [30000, 5000, 1000, 500, 100, 20, 10];
            let formats = [
                (m, s, ms) => `${m}'${s}"`,
                (m, s, ms) => `${m}.${s}:${ms}`,
            ];
            let zoom_formatting = [0,0,1,1,1,1,1];
            zoom_thresholds.some((thresh, i) => {
                if (this.scale > thresh)
                    return false;
                let inc = 0,
                    loc = 0,
                    bias = (((this.viewport/this.scale) % zoom_values[i]) - zoom_values[i])*this.scale,
                    val = zoom_values[i]*this.scale,
                    text = Math.round((-this.viewport-Math.abs(bias))/this.scale);
                p.fill(0);

                p.textAlign(p.LEFT, p.TOP);
                p.textSize(10);
                while (loc < p.width) {
                    p.stroke(120);
                    p.fill(60);
                    loc = inc*val + bias;
                    inc += 1;
                    
                    if (!(text % (zoom_values[i]*5))) {
                        let abstext = Math.abs(text);
                        let min = Math.floor(abstext/60000);
                        let sec = ('0' + Math.floor((abstext-min*60000)/1000)).slice(-2);
                        let ms = ('00' + (abstext % 1000)).slice(-3);
                        let formatter = formats[zoom_formatting[i]];
                        p.text((text >= 0 ? '' : '-') + formatter(min, sec, ms), loc+3, 4);
                        p.line(loc, 10, loc, c.PLAYBACK_HEIGHT);
                    } else
                        p.line(loc, 15, loc, c.PLAYBACK_HEIGHT);
                    text += zoom_values[i];

                    p.stroke(200, 200, 200);
                    for (let v=1; v<5; v++) {
                        let subloc = loc + v*(val/5);
                        p.line(subloc, 20, subloc, c.PLAYBACK_HEIGHT);
                    }
                }
                return true;
            });

            p.line(0, c.PLAYBACK_HEIGHT, p.width, c.PLAYBACK_HEIGHT);
            p.stroke(255, 0, 0);
            p.line(this.viewport, 0, this.viewport, c.PLAYBACK_HEIGHT);
            let gradient_width = 50;
            p.pop();
            while (gradient_width--) {
                let start = p.color(secondary);
                let end = p.color(secondary);
                start.setAlpha(255);
                end.setAlpha(0);
                p.stroke(p.lerpColor(start, end, gradient_width/50))
                p.line(gradient_width, 0, gradient_width, c.PLAYBACK_HEIGHT);
                p.line(p.width - gradient_width, 0, p.width - gradient_width, c.PLAYBACK_HEIGHT);
            }
            // DROP SHADOW
            p.rect(c.PANES_WIDTH, c.PLAYBACK_HEIGHT + 1, p.width, 1);
            let shadow_start = p.color(0);
            let shadow_end = p.color(20);
            shadow_start.setAlpha(200);
            shadow_end.setAlpha(0);
            let depth = 5;
            while (depth--) {
                let s = p.lerpColor(shadow_start, shadow_end, depth/5);
                p.stroke(s);
                p.fill(s);
                p.line(c.PANES_WIDTH, c.PLAYBACK_HEIGHT + depth + 1, p.width, c.PLAYBACK_HEIGHT + depth + 1);
            }
        }

        drawTimesig(numerator, denominator) {
            let denom = typeof denominator === 'string' ?
                denominator : parseInt(denominator, 10);
            p.push();
            p.fill(100);
            if (this.scale > 0.03) {
                p.translate(c.TIMESIG_PADDING, c.TIMESIG_PADDING);
                p.textSize(c.INST_HEIGHT*0.25);
                p.textLeading(c.INST_HEIGHT*0.20);
                p.textAlign(p.LEFT, p.CENTER);
                p.text([numerator, denom].join('\n'), 0, c.INST_HEIGHT/2);
            } else {
                p.translate(c.TIMESIG_PADDING/2, c.TIMESIG_PADDING/2);
                p.textSize(c.INST_HEIGHT*0.1);
                p.textAlign(p.LEFT, p.TOP);
                if (this.scale > 0.02)
                    p.text([numerator, denom].join('/'), 0, 0)
                else 
                    p.text(numerator, 0, 0);
            }
            p.pop();
        }

        select(newSelected) {
            if (newSelected === 'clear') {
                if (this.selected.inst === -1)
                    return false;
                Object.assign(this.selected, { inst: -1, meas: undefined });
                return true;
            }
            if (this.selected.meas) {
                if (newSelected.meas && (this.selected.meas.id === newSelected.meas.id))
                    return false;
                this.editMeas = {};
                delete this.selected.meas.temp;
            }
            Object.assign(this.selected, newSelected);
            return true;
        }
     
        drawFrame() {
            // DRAW BACKGROUND
            p.stroke(secondary_light);
            p.fill(secondary_light);
            p.rect(0, 0, p.width, p.height);
           
        
            // DRAW BOTTOM BAR
            p.stroke(secondary);
            p.fill(secondary);
            p.rect(0, p.height - c.TRACKING_HEIGHT, p.width, c.TRACKING_HEIGHT);
        }

        drawTabs({ locator, cursor_loc, isPlaying }) {
            
            p.push();
            // draw tabs
            p.stroke(primary);
            p.fill(primary);

            p.translate(0, p.height - c.TRACKING_HEIGHT);
            p.rect(0, 0, p.width, c.TRACKING_HEIGHT);
            // left
            
            // LOCATION
            // left    

            p.push();
            p.stroke(secondary);
            p.fill(secondary);
            p.textAlign(p.LEFT, p.TOP);
            p.textSize(10);
            p.text(isPlaying ? `LOCATION: ${Math.round(locator)}` : `CURSOR: ${cursor_loc}`,
                c.TRACKING_PADDING.X, c.TRACKING_PADDING.Y);
            // right
            p.textAlign(p.RIGHT, p.TOP);
            let _span = this.span.map(s => s.toFixed(2)); // format decimal places
            let len = _span[1]-_span[0];
            p.text(`${_span[0]} - ${_span[1]}, \u2248 ${Math.floor(len/60000.0)}'${Math.floor(len/1000.0) % 60}"`, p.width - c.TOOLBAR_WIDTH - c.TRACKING_PADDING.X, c.TRACKING_PADDING.Y);
            p.pop();

            p.translate((p.width - c.TOOLBAR_WIDTH) / 3.0, 0);
            p.textSize(8);
            p.textAlign(p.LEFT, p.CENTER);
            p.stroke(secondary);
            p.fill(secondary);

            p.line(0, 0, 0, c.TRACKING_HEIGHT);
            p.line(c.INSERT_WIDTH, 0, c.INSERT_WIDTH, c.TRACKING_HEIGHT);
            p.translate(c.INSERT_PADDING, 0);
            p.text('- INSERT', 0, c.TRACKING_HEIGHT/2);
            p.text('- EDITOR', c.INSERT_WIDTH, c.TRACKING_HEIGHT/2);
            p.pop();
        }


        _scaleY(input, height, range) {
            return height - (input - range.tempo[0])/(range.tempo[1] - range.tempo[0])*height;
        }

        scaleX(input) {
            return (input*this.scale + this.viewport);
        }

        focus({ scale, viewport }) {
            this.viewport = viewport;
            this.scale = scale;
        }
           
        drawToolbar(tempoRange) { 
            p.push();
            p.stroke(primary);
            p.fill(primary);

            p.translate((p.width - c.TOOLBAR_WIDTH) / 3.0, p.height - c.TRACKING_HEIGHT - c.INSERT_HEIGHT);

            if (this.mode === 1) {
                p.push();
                p.rect(0, 0, c.EDITOR_WIDTH, c.INSERT_HEIGHT);

                p.stroke(secondary);
                p.line(c.INSERT_WIDTH, c.EDITOR_HEIGHT, c.EDITOR_WIDTH, c.EDITOR_HEIGHT); 

                if ('beats' in this.insertMeas) {
                    p.stroke(secondary);
                    p.fill(secondary);

                    // draw beats
                    // push into padding
                    p.push();
                    p.translate(c.INSERT_PADDING, c.INSERT_PADDING);
                    let last = c.EDITOR_WIDTH - c.INSERT_PADDING*2;
                    this.insertMeas.beats.forEach((beat) => {
                        let x = (beat/this.insertMeas.ms)*last;
                        p.line(x, 0, x, c.PREVIEW_HEIGHT);
                    });
                    // draw tempo
                    let ystart = this._scaleY(this.insertMeas.start, c.PREVIEW_HEIGHT, tempoRange);
                    let yend = this._scaleY(this.insertMeas.end, c.PREVIEW_HEIGHT, tempoRange);
                    p.line(0, ystart, last, yend);

                    // push into metadata
                    p.push();
                    p.translate(0, c.PREVIEW_HEIGHT + c.INSERT_PADDING);
                    p.textAlign(p.LEFT, p.TOP);
                    /*let lines = [
                        `${this.insertMeas.start} - ${this.insertMeas.end} / ${this.insertMeas.timesig}`,
                        `${this.insertMeas.ms.toFixed(2)}ms`
                    ];
                    blockText(lines, { x: 0, y: 0 }, 6); 
                    */
                    p.pop();
                    p.pop();
                }
                p.pop();
            };

            if (this.mode === 2) {
                p.rect(0, 0, c.EDITOR_WIDTH, c.EDITOR_HEIGHT);
                p.stroke(secondary);
                p.line(0, c.EDITOR_HEIGHT, c.INSERT_WIDTH, c.EDITOR_HEIGHT); 
                if (this.selected.meas) {
                    // push into padding
                    p.push();
                    p.stroke(secondary);
                    p.translate(c.INSERT_PADDING, c.INSERT_PADDING);
                    let last = c.EDITOR_WIDTH - c.INSERT_PADDING*2;
                    let meas = this.selected.meas;
                    meas.beats.forEach((beat) => {
                        let x = (beat/meas.ms)*last;
                        p.line(x, 0, x, c.PREVIEW_HEIGHT);
                    });
                    // draw tempo
                    let ystart = this._scaleY(meas.start, c.PREVIEW_HEIGHT, tempoRange);
                    let yend = this._scaleY(meas.end, c.PREVIEW_HEIGHT, tempoRange);
                    p.line(0, ystart, last, yend);
                    p.pop();
                }
            }
            p.pop();
        }

        drawEditorFrame(coords, handle) {
            p.push();
            let opac = p.color(primary);
            opac.setAlpha(180);
            p.stroke(opac);
            p.fill(opac);
            p.translate(...coords);
            if (handle)
                p.ellipse(...handle);

            let PANES_THIN = c.PANES_WIDTH/4;
            let inc = 180.0 / c.INST_HEIGHT;
            let op = p.color(primary)
            let end = this.selected.meas.ms*this.scale;
            for (let i=0; i <= c.INST_HEIGHT; i++) {
                op.setAlpha(i*inc);
                p.stroke(op);
                p.line(-PANES_THIN, i, 0, i);
                p.line(end, i, end + PANES_THIN, i);
            }
            p.translate(0, c.INST_HEIGHT);
            p.rect(-PANES_THIN, 0, PANES_THIN*2 + this.selected.meas.ms*this.scale, c.LOCK_HEIGHT);

            p.stroke(secondary);
            p.fill(secondary);
            p.textSize(10);
            p.textAlign(p.LEFT, p.CENTER);
            //p.text(`${select.start} -> ${select.end} / ${select.timesig}`, 5, c.PANES_WIDTH);
                
            p.pop();
        }
    };
    return new _Window();

}

