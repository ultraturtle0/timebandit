/**
 * P5js sketch for main display
 * @module sketch
 */

import { order_by_key, check_proximity_by_key, parse_bits } from '../Util/index.js';
//import { bit_toggle } from '../Util/index.js';
import logger from '../Util/logger.js';
import c from '../config/CONFIG.json';
import { primary, secondary, secondary_light2 } from '../config/CONFIG.json';
import { colors } from 'bandit-lib';
//import { secondary, secondary_light, } from '../config/CONFIG.json';
//import _ from 'lodash';
import _Window from '../Util/window.js';
import _Mouse from '../Util/mouse.js';
import _Keyboard from '../Util/keyboard.js';
import { Debugger } from '../Util/debugger.js';
import keycodes from '../Util/keycodes.js';
import { CTRL, MOD } from '../Util/keycodes.js';
import tutorials from '../Util/tutorials/index.js';


const DEBUG = process.env.NODE_ENV === 'development';
const SLOW = process.env.NODE_ENV === 'development';

var API = {};
var K;


var crowding = (gaps, position, ms, options) => {
    let strict = (options && 'strict' in options) ? options.strict : false;
    let final = position + ms;
    if (final <= gaps[0][1]) 
        return { start: [-Infinity, Infinity], end: [gaps[0][1], gaps[0][1] - (final)] };
    let last_gap = gaps.slice(-1)[0];
    if (position > last_gap[0])
        return { start: [last_gap[0], position - last_gap[0]], end: [Infinity, Infinity] };
        
    return gaps
        .reduce((acc, gap) => {
            // does it even fit in the gap?
            if (gap[1] - gap[0] < ms - (strict ? c.NUDGE_THRESHOLD*2 : 0))
                return acc;
            let start = [gap[0], position - gap[0]];
            let end = [gap[1], gap[1] - final];

            /*if (gap[0] === -Infinity && final <= gap[1])
                acc.start = [-Infinity, Infinity]
            else*/ if (Math.abs(start[1]) < Math.abs(acc.start[1]))
                acc.start = start;
            /*if (gap[1] === Infinity && position >= gap[0])
                acc.end = [Infinity, Infinity]
            else*/ if (Math.abs(end[1]) < Math.abs(acc.end[1]))
                acc.end = end;
            return acc;
        }, { start: [0, Infinity], end: [0, Infinity], gap: [] });
}



const [SPACE, DEL, BACK, ESC] = [32, 46, 8, 27];
//const [SHIFT, ALT] = [16, 18];
const [KeyC, KeyI, KeyV] = [67, 73, 86];
//const [KeyH, KeyJ, KeyK, KeyL] = [72, 74, 75, 76];
//const [KeyZ] = [90];
//const [LEFT, UP, RIGHT, DOWN] = [37, 38, 39, 40];
const NUM = []
for (let i=48; i < 58; i++)
    NUM.push(i);

// generates measure.gaps in 'measure' drag mode
var calcGaps = (measures, id) => {
    var last = false;
    // ASSUMES MEASURES ARE IN ORDER
    return measures.reduce((acc, meas, i) => {
        // skip measure in question
        if (id && (meas.id === id))
            return acc;
        acc = [...acc, [
            (last) ? last.offset + last.ms : -Infinity,
            meas.offset
        ]];
        last = meas;
        return acc;
    }, [])
        .concat([[ last.offset + last.ms, Infinity ]]);
};

// tweaks learning rate for nudge algorithms
var monitor = (gap, new_gap, alpha) => {
    let progress = Math.abs(gap) - Math.abs(new_gap);
    if (gap + new_gap === 0 || progress === 0)
        return alpha;

    let perc = Math.abs(progress)/Math.abs(gap);
    if (progress < 0)
        alpha *= -1;

    return alpha * (1-perc)/perc;
};

/* THIS SYSTEM MAY WORK BETTER FOR FRACTIONAL BEATS
var insert = (list, item) => {
    if (!list.length)
        return [item];

    var center = Math.floor(list.length/2);
    
    if (item === list[center]) {
        return list;
    };
    if (!center) {
        if (item > list[0])
            return list.concat([item]);
        return [item].concat(list);
    }

    var left = list.slice(0, center);
    var right = list.slice(center);
    if (item > list[center])
        return left.concat(insert(right, item));
    return insert(left, item).concat(right);
}; */

// holds arrays of beats by measure id key, MOVE THIS LATER
var locked = {};


var range = [0, 100];

export default function measure(p) {
    // monkey-patching Processing for a p.mouseDown function
    p.mouseDown = false;

    var instruments = [];

    // temporary holding for editing measures
    var copied;

    var locks = 0;

    var snaps = {
        divs: [],
        div_index: 0,
        snapped_inst: {}
    };

    // cached from nudge algorithm as { start, slope, offset, ms }
    var nudge_cache = false;
    // { start: [location, distance-from-location], end: [location, distance-from-location], gap: []}
    var crowd_cache = false;

    // misc
    var isPlaying = false;

    var Window = _Window(p);
    var Mouse = _Mouse(p, Window);
    var Keyboard = _Keyboard(p);


    var ms_to_x = ms => (ms*Window.scale + Window.viewport);
    var x_to_ms = x => (x-Window.viewport)/Window.scale;

    // debugger
    var Debug = new Debugger(p, Window, Mouse);

    var subs = [];
    var buttons = [];
    var core_buttons = [];
    var subscriber = (type, func) => {
        return (type === 'draw') ?
            subs.push(func) :
            buttons.push(func);
    };


    var tuts = tutorials(p, subscriber, API, Window);

    p.setup = function () {
        p.createCanvas(p.windowWidth - c.CANVAS_PADDING * 2, p.windowHeight - c.FOOTER_HEIGHT);
        p.background(255);
    };

    p.windowResized = function () {
        p.resizeCanvas(p.windowWidth - c.CANVAS_PADDING * 2, p.windowHeight - c.FOOTER_HEIGHT);
        // override Y scroll
        Window.updateView({ deltaX: 0, deltaY: 0 }, {});
    }

    p.myCustomRedrawAccordingToNewPropsHandler = function (props) { 
        instruments = props.instruments;
        Window.insertMeas = props.insertMeas;
        Window.selected = props.selected || ({ inst: -1, meas: undefined });
        Window.editMeas = props.editMeas;
        Window.panels = props.panels;
        Window.mode = props.mode;
        Window.insts = props.instruments.length;
        Object.assign(API, props.API);
        Window.setUpdateViewCallback(API.reportWindow);

        // THIS SHOULD BE MOVED INTO APP.JS WITH DEPENDENCIES
        // PASSED IN THE OTHER DIRECTION!
        API.registerTuts(tuts);

        

        Window.CONSTANTS = props.CONSTANTS;
        K = 60000.0 / Window.CONSTANTS.PPQ;
        core_buttons = [];
        core_buttons.push(() => {
            let insert_x = (p.width - c.TOOLBAR_WIDTH) / 3.0;
            if (p.mouseX > insert_x &&
                p.mouseX < insert_x + c.INSERT_WIDTH &&
                p.mouseY > p.height - c.TRACKING_HEIGHT &&
                p.mouseY < p.height
            ) {
                Window.mode = (Window.mode === 1) ? 0 : 1;
                API.updateMode(Window.mode);
                return true;
            } else
                return false;
        });
        core_buttons.push(() => {
            let insert_x = (p.width - c.TOOLBAR_WIDTH) / 3.0 + c.INSERT_WIDTH;
            if (p.mouseX > insert_x &&
                p.mouseX < insert_x + c.INSERT_WIDTH &&
                p.mouseY > p.height - c.TRACKING_HEIGHT &&
                p.mouseY < p.height
            ) {
                Window.mode = (Window.mode === 2) ? 0 : 2;
                API.updateMode(Window.mode);
                return true;
            } else
                return false;
        });

        /*var beat_lock = (Window.selected.meas && Window.selected.meas.id in locked && locked[Window.selected.meas.id].beats) ?
            parse_bits(locked[Window.selected.meas.id].beats) : [];*/

        var beat_lock = {};
        if (Window.selected.meas && 'locks' in Window.selected.meas) {
            let lock_candidates = Object.keys(Window.selected.meas.locks);
            if (lock_candidates.length)
                beat_lock = { beat: lock_candidates[0], type: Window.selected.meas.locks[lock_candidates[0]] };
        }

        // reset select, begin logging on update
        if (Window.selected.inst > -1 && Window.selected.meas)
            Window.selected.meas = instruments[Window.selected.inst].measures[Window.selected.meas.id];

        if ('ms' in Window.editMeas) {
            Window.selected.meas.temp = Window.editMeas;
            if ('beat' in beat_lock)
                Window.selected.meas.temp.offset = Window.selected.meas.temp.offset + Window.selected.meas.beats[beat_lock.beat] - Window.editMeas.beats[beat_lock.beat];
        } else if (Window.selected.meas && 'temp' in Window.selected.meas)
            delete Window.selected.meas.temp;

        if ('locks' in props)
            locks = props.locks.reduce((acc, lock) => (acc |= (1 << lock)), 0); 

        // REFACTOR ORDERING INTO NUM ITERATIONS LATER
        instruments.forEach((inst) => {
            inst.ordered = order_by_key(inst.measures, 'offset');
            if (inst.ordered.length) {
                let last = inst.ordered[inst.ordered.length - 1];
                Window.span = [
                    Math.min(Window.span[0], inst.ordered[0].offset),
                    Math.max(Window.span[1], last.offset + last.ms)
                ];
            };
        });

        // rewrite this
        logger.log('Recalculating snap divisions...');
        snaps.divs = NUM.slice(1).reduce((acc, num, n_ind) => {
            let add_snaps = {};
            let div = Window.CONSTANTS.PPQ / (n_ind + 1);
            instruments.forEach((inst, i_ind) =>
                inst.ordered.forEach((measure) => {
                    for (let i=0; i < measure.ticks.length; i += div) {
                        let tick = Math.round(i);
                        let target = (tick >= measure.ticks.length) ?
                            measure.ms : measure.ticks[tick];
                        let loc = (target + measure.offset).toString();
                        let obj = { inst: i_ind, meas: measure.id };
                        if (loc in add_snaps)
                            add_snaps[loc].push(obj)
                        else
                            add_snaps[loc] = [obj];
                    };
                }) , {});
            return [...acc, add_snaps];
        }, []);

        range = Window.CONSTANTS.range;
        

    }

    p.draw = function () {
        if (SLOW)
            p.frameRate(10);

        // reset Mouse.rollover cursor
        Mouse.cursor = 'default';

        // key check
        ['CTRL', 'SHIFT', 'MOD', 'ALT'].forEach(k =>
            Object.assign(Window.mods, { [k.toLowerCase()]: p.keyIsDown(keycodes[k]) }));
        snaps.div_index = (Keyboard.num_counter) ?
            Keyboard.held_nums[Keyboard.held_nums.length-1] - 1 : 0;

        Window.drawFrame();

        // push below playback bar
        p.push();
        Mouse.push({ x: c.PANES_WIDTH, y: c.PLAYBACK_HEIGHT });

        p.translate(0, c.PLAYBACK_HEIGHT);
        p.stroke(primary);
        p.fill(primary);
        p.rect(0, 0, c.PANES_WIDTH, p.height);
        p.translate(c.PANES_WIDTH, 0);


        // update Mouse location
        let new_rollover = {};
        instruments.forEach((inst, i_ind) => {
            var yloc = i_ind*c.INST_HEIGHT - Window.scroll;

            p.push();
            p.translate(0, yloc);
            Mouse.push({ x: 0, y: yloc });
            if (Mouse.drag.mode === '')
                Mouse.rolloverCheck([null, 0, null, c.INST_HEIGHT], {
                    type: 'inst',
                    inst: i_ind,
                });

            // push into instrument channel
            p.stroke(colors.accent);
            p.fill(secondary_light2);

            // handle inst selection
            if (!Window.selected.meas && Window.selected.inst === i_ind)
                p.fill(230);

            p.rect(0, 0, p.width-1, 99);

            inst.ordered.forEach((measure, m_ind) => {
                let key = measure.id;


                let temp = 'temp' in measure;
                var [ticks, beats, offset, ms, start, end] = temp ?
                    [measure.temp.ticks, measure.temp.beats, measure.temp.offset, measure.temp.beats.slice(-1)[0], measure.temp.start || measure.start, measure.temp.end || measure.end] :
                    [measure.ticks, measure.beats, measure.offset, measure.beats.slice(-1)[0], measure.start, measure.end];


                let position = (tick) => (tick*Window.scale + Window.viewport);
                let origin = position(offset);
                let final = ms * Window.scale;

                 // skip if offscreen
                if (origin + final < 0 ||
                    origin > p.width
                )
                    return;
               
                // push into first beat
                p.push();
                p.translate(origin, 0);
                Mouse.push({ x: origin, y: 0 });
                if (Mouse.drag.mode === '')
                    Mouse.rolloverCheck([0, 0, final, c.INST_HEIGHT], {
                        ind: m_ind, type: 'measure', meas: measure
                    });

                // handle selection
                if (Window.selected.meas && key === Window.selected.meas.id) {
                    p.fill(0, 255, 0, 60);
                    p.rect(0, 0, final, c.INST_HEIGHT);
                }

                // draw ticks
                p.stroke(240);
                let step = 1;
                // BREAK OUT INTO FUNCTION
                if (Window.scale < 1) { 
                    if (Window.scale < 0.05)
                        step = (Window.scale < 0.025) ? Window.CONSTANTS.PPQ : Window.CONSTANTS.PPQ_mod * 2 
                    else 
                        step = Window.CONSTANTS.PPQ_mod;
                };

                for (var i=0; i < ticks.length; i += step) {
                    let loc = ticks[i]*Window.scale;
                    // skip if offscreen
                    if (loc + origin > p.width || loc + origin < 0)
                        continue;
                    p.line(loc, 0, loc, c.INST_HEIGHT);
                };

                // draw timesig
                Window.drawTimesig(measure.timesig, '4');

                // draw beats
                beats.forEach((beat, index) => {
                    let coord = beat*Window.scale;
                    let alpha = 255;
                    let color = ('locks' in measure && index in measure.locks) ?
                        p.color(0, 0, 255) : p.color(colors.accent);

                    // bypass first beat when fading
                    if (Window.scale < 0.05 && (index !== 0))
                        alpha = Math.max(60, 255*(Window.scale/0.05));

                    // try Mouse.rollover
                    if (!temp && Mouse.rolloverCheck( 
                        [coord-c.ROLLOVER_TOLERANCE, 0, coord+c.ROLLOVER_TOLERANCE, c.INST_HEIGHT],
                        { type: 'beat', beat: index }
                    )) {
                        alpha = 100;
                        if (Window.mods.mod && Window.selected.meas) {
                            // change Mouse.rollover cursor
                            Mouse.cursor = (Window.mods.shift) ?
                                'text' : 'pointer';

                            if (key in locked) {
                                let bits = parse_bits(locked[key].beats);
                                if ((bits.length >= 2 && (bits.indexOf(new_rollover.beat) === -1) && !Window.mods.shift)
                                    || (bits.indexOf(new_rollover.beat) !== -1 && Window.mods.shift)
                                )
                                    Mouse.cursor = 'not-allowed';
                            };
                        } 
                    }

                    color.setAlpha(alpha);
                    p.stroke(color);
                    p.line(coord, 0, coord, c.INST_HEIGHT);
                });
                Mouse.pop();

                // draw tempo graph
                p.stroke(240, 200, 200);
                let bottom = ('temprange' in range) ?
                    (range.temprange[0] || range.tempo[0]) :
                    range.tempo[0];
                let top = ('temprange' in range) ?
                    (range.temprange[1] || range.tempo[1]) :
                    range.tempo[1];
                let spread = top - bottom;

                let ystart = c.INST_HEIGHT - (start - bottom)/spread*c.INST_HEIGHT;
                let yend = c.INST_HEIGHT - (end - bottom)/spread*c.INST_HEIGHT;

                let last = [0, ystart];
                beats.slice(1).forEach((beat, i) => {
                    let next = [
                        beat * Window.scale,
                        c.INST_HEIGHT - ((((i+1)/measure.timesig)*(end-start) + start) - bottom)/spread*c.INST_HEIGHT
                    ];
                    p.line(last[0], last[1], next[0], next[1]);
                    last = next;
                });

                // draw tempo markings
                p.fill(100);
                p.textSize(c.TEMPO_PT);
                let sigfig = Window.scale > 0.05 ? 2 : 0;
                let tempo_loc = { x: position(0) + c.TEMPO_PADDING };
                if (ystart > c.TEMPO_PT + c.TEMPO_PADDING) {
                    p.textAlign(p.LEFT, p.BOTTOM);
                    tempo_loc.y = ystart - c.TEMPO_PADDING;
                } else {
                    p.textAlign(p.LEFT, p.TOP);
                    tempo_loc.y = ystart + c.TEMPO_PADDING;
                };
                p.text(start.toFixed(sigfig), c.TEMPO_PADDING, tempo_loc.y);

                tempo_loc = { x: position(ms) - c.TEMPO_PADDING };
                if (yend > c.TEMPO_PT + c.TEMPO_PADDING) {
                    p.textAlign(p.RIGHT, p.BOTTOM);
                    tempo_loc.y = yend - c.TEMPO_PADDING;
                } else {
                    p.textAlign(p.RIGHT, p.TOP);
                    tempo_loc.y = yend + c.TEMPO_PADDING;
                };
                p.text(end.toFixed(sigfig), ms*Window.scale - c.TEMPO_PADDING, tempo_loc.y);

                // return from measure translate
                p.pop();

            });

            // draw snap
            if (snaps.snapped_inst) {
                p.stroke(200, 240, 200);
                let x = snaps.snapped_inst.target * Window.scale + Window.viewport;
                p.line(x, Math.min(snaps.snapped_inst.origin, snaps.snapped_inst.inst)*c.INST_HEIGHT,
                    x, (Math.max(snaps.snapped_inst.origin, snaps.snapped_inst.inst) + 1)*c.INST_HEIGHT);
            };

            let nameColor = p.color('rgba(0,0,0,0.25)');
            p.stroke(nameColor);
            p.fill(nameColor);
            p.textAlign(p.LEFT, p.TOP);
            p.text(inst.name, 10, c.INST_HEIGHT - 20);
            p.pop();
            Mouse.pop();
        });

        // draw snaps
        p.stroke(100, 255, 100);
        if (snaps.div_index >= 1)
            Object.keys(snaps.divs[snaps.div_index]).forEach(key => {
                let inst = snaps.divs[snaps.div_index][key][0].inst;
                let xloc = key*Window.scale + Window.viewport;
                let yloc = inst * c.INST_HEIGHT - Window.scroll;
                p.line(xloc, yloc, xloc, yloc + c.INST_HEIGHT);
            });

        let mouse = (p.mouseX - Window.viewport)/Window.scale - c.PANES_WIDTH;
        let cursor_loc = [parseInt(Math.abs(mouse / 3600000), 10)];
        cursor_loc = cursor_loc.concat([60000, 1000].map((num) =>
            parseInt(Math.abs(mouse / num), 10).toString().padStart(2, "0")))
            .join(':');
        cursor_loc += '.' + parseInt(Math.abs(mouse % 1000), 10).toString().padStart(3, "0");
        if (mouse < 0.0)
           cursor_loc = '-' + cursor_loc;

        // draw editor frame
        if (Window.mode === 2 && Window.selected.meas) {
            
            let select = Window.selected.meas;
            let x = select.offset * Window.scale + Window.viewport;
            let y = Window.selected.inst*c.INST_HEIGHT - Window.scroll;
            Mouse.push({ x, y });

            let spread = Math.abs(range.tempo[1] - range.tempo[0]);
            let tempo_slope = (select.end - select.start)/select.timesig;
            let slope = tempo_slope/spread*c.INST_HEIGHT; 
            let base = (select.start - range.tempo[0])/spread*c.INST_HEIGHT;


            // MOVE THIS BLOCK TO BEAT DRAWING BLOCK WHEN QUEUING
            let handle;
            if (Mouse.drag.mode === 'tempo' && 'temp' in select) {
                handle = [select.temp.beats[Mouse.drag.index]*Window.scale, Mouse.loc.y, 10, 10]; 
                Mouse.cursor = 'ns-resize';
            } else if (Mouse.drag.mode !== 'tick') {
                for (let i=1; i < select.beats.length; i++) {
                    let xloc = select.beats[i-1]*Window.scale;
                    let xloc2 = select.beats[i]*Window.scale;
                    let width = xloc2-xloc;
                    let yloc = c.INST_HEIGHT - base - slope*(i-1);

                    let tolerance = 5;

                    let func = () => {
                        let ytarget = (p.mouseX-c.PANES_WIDTH-x-xloc)/width*slope + slope*(i-1) + base;
                        let mouseloc = p.mouseY-c.PLAYBACK_HEIGHT;
                        let tempo_target = c.INST_HEIGHT*(Window.selected.inst+1)-ytarget;
                        return (mouseloc < tempo_target + tolerance
                        && mouseloc > tempo_target - tolerance);
                    };

                    if (Mouse.rolloverCheck([xloc, 0, xloc2, c.INST_HEIGHT], {
                        type: 'tempo',
                        tempo: tempo_slope*i + select.start,
                        // this is a little sketchy but it works for now.
                        beat: i > select.beats.length/2 ? select.timesig-1 : 0
                    },
                    func)) {
                        handle = [xloc, yloc, 10, 10]; 
                        break;
                    }
                };
            };
            
            Window.drawEditorFrame([x, y], handle);
            Mouse.pop();

        }
        Mouse.pop();

        if (DEBUG) {
            Debug.push(`viewport: ${Window.viewport}`);
            Debug.push(`scale: ${Window.scale}`);
            Debug.push(`scroll: ${Window.scroll}`);
            Debug.write({ x: 0, y: (instruments.length+1)*c.INST_HEIGHT + c.DEBUG_TEXT }, c.DEBUG_TEXT);
            Debug.frameRate();
            Debug.clear();
        };

            

        // draw cursor / insertMeas
        p.stroke(200);
        p.fill(240);
        Mouse.push({x: c.PANES_WIDTH, y:0});
        let t_mouseX = p.mouseX - Mouse.loc.x;
        let t_mouseY = p.mouseY - Mouse.loc.y;
        p.line(t_mouseX, 0, t_mouseX, c.INST_HEIGHT*instruments.length);
        let draw_beats = beat => {
            let x = ('inst' in Window.insertMeas) ? 
                (Window.insertMeas.temp_offset + beat) * Window.scale + Window.viewport :
                t_mouseX + beat*Window.scale;
            let y = ('inst' in Window.insertMeas) ?
                Window.insertMeas.inst * c.INST_HEIGHT - Window.scroll :
                Math.floor(0.01*t_mouseY)*c.INST_HEIGHT - Window.scroll;
            p.line(x, y, x, y + c.INST_HEIGHT);
        };
        Mouse.pop();

        if (Window.mode === 1) {
            let inst = Math.floor(0.01*t_mouseY);
            if (API.pollSelecting()) {
                if (inst < instruments.length && inst >= 0) {
                    if (!instruments[inst].gap_cache)
                        instruments[inst].gap_cache = calcGaps(instruments[inst].ordered, '');

                    let offset = x_to_ms(p.mouseX - c.PANES_WIDTH); //(p.mouseX - Window.viewport - c.PANES_WIDTH)/Window.scale;
                    let crowd = crowding(instruments[inst].gap_cache, offset, Window.insertMeas.ms, { strict: true });

                    let crowd_start = crowd.start[0];
                    let crowd_end =  crowd.end[0];

                    Debug.push(`mouse: ${crowd_start}, ${crowd_end}`);
                    if (offset < crowd_start + c.SNAP_THRESHOLD && offset > crowd_start - Window.insertMeas.ms/2)
                        offset = crowd_start
                    else if (offset + Window.insertMeas.ms + c.SNAP_THRESHOLD > crowd_end)
                        offset = crowd_end - Window.insertMeas.ms;

                    let offset_x = ms_to_x(offset);
                    p.rect(offset_x, inst*c.INST_HEIGHT, Window.insertMeas.ms*Window.scale, c.INST_HEIGHT);
                    Window.insertMeas.temp_offset = offset;
                    p.stroke(255, 0, 0);
                    if ('beats' in Window.insertMeas)
                        Window.insertMeas.beats.forEach(beat => {
                            let x = /*('inst' in Window.insertMeas) ? 
                                (Window.insertMeas.temp_offset + beat) * Window.scale + Window.viewport :
                                Window.insertMeas.temp_offset + beat*Window.scale;*/
                                ms_to_x(Window.insertMeas.temp_offset + beat);
                            let y = ('inst' in Window.insertMeas) ?
                                Window.insertMeas.inst * c.INST_HEIGHT - Window.scroll :
                                Math.floor(0.01*t_mouseY)*c.INST_HEIGHT - Window.scroll;
                            p.line(x, y, x, y + c.INST_HEIGHT);
                        });
                }
            } else if ('temp_offset' in Window.insertMeas) {
                p.rect(Window.insertMeas.temp_offset*Window.scale + Window.viewport, Window.selected.inst*c.INST_HEIGHT, Window.insertMeas.ms*Window.scale, c.INST_HEIGHT);
                p.stroke(255, 0, 0);
                Window.insertMeas.beats.forEach(draw_beats);
            };
        };


        isPlaying = API.get('isPlaying');

        p.stroke(0);
        p.fill(0);
        p.textAlign(p.LEFT, p.TOP);
        p.textSize(12);

        
        if (isPlaying) {
            let tracking = API.exposeTracking().locator();
            // check for final measure here;
            if (tracking > range.span[1] + 1000) {
                isPlaying = false;
                API.play(isPlaying, null);
            };
            let tracking_vis = tracking*Window.scale + Window.viewport;
            p.line(tracking_vis, c.PLAYBACK_HEIGHT, tracking_vis, c.INST_HEIGHT*2 + c.PLAYBACK_HEIGHT);
        };

        Mouse.dragCursorUpdate();
        document.body.style.cursor = Mouse.cursor;


                

        p.pop();

        // draw lock menu
        if (Mouse.drag.mode === 'lock') {
            p.push();
            p.translate(p.mouseDown.x, p.mouseDown.y);

            p.fill(primary);
            p.stroke(primary);
            p.rect(-45, -10, 35, 20);
            p.rect(10, -10, 35, 20);
            p.rect(-17, -20, 35, 20);
            p.stroke(secondary)
            p.fill(secondary)
            p.textSize(10);
            p.textAlign(p.CENTER, p.CENTER);
            p.text('loc', -27, 0);
            p.text('tempo', 27, 0);
            p.text('both', 0, -10);
            Mouse.lock_type = null;

            if (p.mouseX > p.mouseDown.x - 17 &&
                p.mouseX < p.mouseDown.x + 18 &&
                p.mouseY > p.mouseDown.y - 20 &&
                p.mouseY < p.mouseDown.y + 0
            ) {
                p.stroke(primary);
                p.rect(-17, -20, 35, 20);
                p.fill(primary);
                p.text('both', 0, -10);
                Mouse.lock_type = 'both'
            } else if (p.mouseY > p.mouseDown.y - 10 &&
                p.mouseY < p.mouseDown.y + 10
            ) {
                if (p.mouseX < p.mouseDown.x - 10 &&
                    p.mouseX > p.mouseDown.x - 45
                ) {
                    p.stroke(primary);
                    p.rect(-45, -10, 35, 20);
                    p.fill(primary);
                    p.text('loc', -27, 0);
                    Mouse.lock_type = 'loc'
                }
                else if (p.mouseX < p.mouseDown.x + 45 &&
                    p.mouseX > p.mouseDown.x + 10
                ) {
                    p.stroke(primary);
                    p.rect(10, -10, 35, 20);
                    p.fill(primary);
                    p.text('tempo', 27, 0);
                    Mouse.lock_type = 'tempo';
                }
            }
            p.pop();
        }
       

        Window.drawPlayback();
        Window.drawTabs({ locator: API.exposeTracking().locator(), cursor_loc, isPlaying });
        Window.drawToolbar(range);
        Mouse.updateRollover();

        if (Window.panels) {
            p.fill(255, 0, 0, 10);
            p.rect(0, c.PLAYBACK_HEIGHT + c.INST_HEIGHT*instruments.length - Window.scroll, p.width, c.INST_HEIGHT);
        };
            
        subs.forEach(sub => sub());

        // do that sibelius check thing here
        if (API.sibeliusCheck()) {
            let sib_window_size = 10000*Window.scale;
            p.push()
            p.translate(p.mouseX - sib_window_size*0.5, c.PLAYBACK_HEIGHT);
            let sib_color = p.color(colors.contrast_light);
            sib_color.setAlpha(0.25);
            p.rect(0, 0, sib_window_size, instruments.length*c.INST_HEIGHT);
            p.pop();
        }

    }

    p.keyReleased = function(e) {
        if (!API.checkFocus() && Keyboard.checkNumRelease())
            return false;
        return false;
    }

    p.keyPressed = function(e) {
        if (API.modalCheck())
            return;

        if (p.keyCode === ESC) {
            if (Window.mode === 0)
                API.toggleInst(true);
            else {
                Window.mode = 0;
                API.updateMode(Window.mode);
            }
            return;
        };

        if (API.disableKeys()) 
            return;
        if (API.checkFocus()) // && Keyboard.checkNumPress())
            return;


        // CTRL/MOD functions
        if (p.keyIsDown(MOD)) {
            if (p.keyCode === KeyC
                && Window.selected.meas
            ) {

                logger.log(`Copying measure ${Window.selected.meas.id}.`);
                copied = Window.selected.meas; //instruments[Window.selected.inst].measures[Window.selected.meas];
                return;
            } else if (p.keyCode === KeyV && copied) {
                API.paste(Window.selected.inst, copied, (p.mouseX-Window.viewport-c.PANES_WIDTH)/Window.scale);
                return;
            }
            /* ADD UNDO HISTORY HERE
            else if (p.keyCode === KeyZ)
                p.keyIsDown(SHIFT) ?
                    API.redo() : API.undo();
            */
        };

        let dir = Keyboard.checkDirection();
        if (Window.selected.meas && dir) {
            if (dir === 'DOWN') {
                if (Window.selected.inst >= instruments.length - 1)
                    return;
                let ind = check_proximity_by_key(Window.selected.meas, instruments[Window.selected.inst + 1].ordered, 'offset');
                Window.select({ ind,
                    inst: Math.min(Window.selected.inst + 1, instruments.length - 1),
                    meas: instruments[Window.selected.inst + 1].ordered[ind],
                });
            } else if (dir === 'UP') { // || p.keyCode === UP) {
                if (Window.selected.inst <= 0)
                    return;
                let ind = check_proximity_by_key(Window.selected.meas, instruments[Window.selected.inst - 1].ordered, 'offset');
                Window.select({ ind,
                    inst: Math.max(Window.selected.inst - 1, 0),
                    meas: instruments[Window.selected.inst -1].ordered[ind],
                });
            } else if (dir === 'LEFT') { // || p.keyCode === LEFT) {
                let ind = Math.max(Window.selected.ind - 1, 0);
                Window.select({ ind,
                    inst: Window.selected.inst,
                    meas: instruments[Window.selected.inst].ordered[ind]
                });
            } else if (dir === 'RIGHT') { // || p.keyCode === RIGHT) {
                let ind =  Math.min(Window.selected.ind + 1, instruments[Window.selected.inst].ordered.length - 1);
                Window.select({ ind,
                    inst: Window.selected.inst,
                    meas: instruments[Window.selected.inst].ordered[ind]
                });
            };
            return;
        }


        if (p.keyCode === KeyI) {
            Window.mode = 1;
            API.updateMode(Window.mode);
            return;
        };

        if (p.keyCode === KeyV) {
            Window.mode = 2;
            //API.displaySelected(Window.selected);
            API.updateMode(Window.mode);
            return;
        };


        if ((p.keyCode === DEL || p.keyCode === BACK)) {
            if (!API.checkFocus() && Window.selected.meas) {
                let to_delete = Window.selected;
                Window.selected = { inst: -1 };
                API.deleteMeasure(to_delete);
            }
            return;
        }

        if (p.keyCode === SPACE) {
            (Window.mode === 1) ?
                API.preview((p.mouseX - Window.viewport)/Window.scale) :
                API.play((p.mouseX - Window.viewport)/Window.scale);
            return;
        }

        return true;
    };

    p.mouseWheel = function(event) {
        if (API.modalCheck())
            return;
        if (p.mouseX < 0 || p.mouseX > p.width ||
            p.mouseY < 0 || p.mouseY > p.height
        )
            return;
        event.preventDefault();
        let zoom = p.keyIsDown(MOD);
        Window.updateView(event, { zoom });
        /*if (zoom)
            API.newScaling(Window.scale);*/
        API.reportWindow(Window.viewport, Window.scale, Window.scroll);
    };

    p.mousePressed = function(e) {
        if (API.modalCheck())
            return;
        p.mouseDown = { x: p.mouseX, y: p.mouseY };
        let block = tuts._mouseBlocker();
        if (block)
            return;
        Mouse.updatePress(buttons);
        Mouse.updatePress(core_buttons);

        if (Mouse.outside_origin)
            return;

        let inst = Math.floor((p.mouseY-c.PLAYBACK_HEIGHT)/c.INST_HEIGHT);
        if (inst >= instruments.length || inst < 0)
            return;

        if (API.sibeliusCheck()) {
            let w = 14*72;
            let h = 8.5*72;
            let margins = [0.05*w, 0.05*h];
            let img = p.createImage(w, h);
            let duration = 10000;
            let ratio = (w*0.9)/duration;
            img.loadPixels();
            let inst_height = h/instruments.length;
            let click_loc = x_to_ms(p.mouseX-c.PANES_WIDTH);
            console.log(click_loc);
            let click_window = [click_loc-duration*0.5, click_loc+duration*0.5];
            console.log(click_window);
            instruments.forEach((inst, ind) => {
                console.log('entering inst', ind);
                Object.keys(inst.measures).forEach(key => {
                    let meas = inst.measures[key];
                    console.log('entering meas', key);
                    meas.beats.forEach((beat, i) => {
                        let loc = meas.offset + beat;
                        console.log(loc, loc-click_window[0]);
                        if (loc < click_window[1] &&
                            loc > click_window[0]
                        ) {
                            for (let y=0; y<inst_height; y++) {
                                img.set(Math.round((loc-click_window[0])*ratio) + margins[0],
                                    y+ind*inst_height,
                                    (i===0) ? p.color(100, 0, 255) : p.color(255, 0, 100)
                                );
                            }
                        }
                    });
                });
            });

            img.updatePixels();
            p.save(img, 'sibelius.png');
        }
        if (API.pollSelecting()) {
            API.confirmSelecting(inst, Window.insertMeas.temp_offset);
            e.preventDefault();
            Window.insertMeas.inst = inst;
            return;
        }

        Mouse.select();

        if (Window.selected.meas) {
            //let [shift, ctrl] = [p.keyIsDown(SHIFT), p.keyIsDown(CTRL)];
            if (Window.mods.shift) {
                if (Window.mods.mod)
                    Mouse.tickMode()
                else
                    Mouse.measureMode();
            } else if (Window.mods.mod) {
                Mouse.beatLock();
            }
        };

        API.displaySelected(Window.selected);
    }

    p.mouseDragged = function(event) {
        if (!Mouse.drag.mode || Mouse.drag.mode === 'lock')
            return;
        if (Mouse.rollover.beat === 0
            || Mouse.outside_origin
            || Window.selected.meas === -1)
            return;

        if (!(Window.selected.meas))
            return;

        let lock_candidates = ('locks' in Window.selected.meas) ?
            Object.keys(Window.selected.meas.locks) : [];
        var beat_lock = lock_candidates.length ?
            ({ beat: parseInt(lock_candidates[0], 10), type: Window.selected.meas.locks[lock_candidates[0]] }) :
            {};

            
            /*(Window.selected.meas.id in locked && locked[Window.selected.meas.id].beats) ?
            parse_bits(locked[Window.selected.meas.id].beats) : [];
            */

        var ticks = (Window.selected.meas.timesig) * Window.CONSTANTS.PPQ_tempo;
        var tick_array = Array.from({length: ticks}, (__, i) => i);


        var closest = (position, inst, div) =>
            Object.keys(snaps.divs[div]).reduce((acc, key, ind, keys) => {
                if (snaps.divs[div][key][0].inst === inst)
                    return acc;
                let gap = parseFloat(key, 10) - position;
                return (Math.abs(gap) < Math.abs(acc.gap) ? 
                    { target: parseFloat(key, 10), gap, inst: snaps.divs[div][key][0].inst } :
                    acc);
            }, { target: -1, gap: Infinity, inst: -1 });

        var snap_eval = (position, candidates, exempt) =>
            candidates.reduce((acc, candidate, index) => {
                let next = position + candidate;
                let target, gap, inst;
                ({ target, gap, inst } = closest(next, Window.selected.inst, snaps.div_index));
                if (Math.abs(gap) < Math.abs(acc.gap)) {
                    if (exempt !== undefined && index === exempt) {
                        return acc;
                    }
                    return { index, target, gap, inst };
                }
                return acc;
            }, { index: -1, target: Infinity, gap: Infinity, inst: -1 });

        let measure = Window.selected.meas;
        /*if (!('temp' in measure))
            measure.temp = initialize_temp(measure);
            */
        if (!('gaps' in measure))
            measure.gaps = calcGaps(instruments[Window.selected.inst].ordered, Window.selected.meas.id);


        var PPQ_mod = Window.CONSTANTS.PPQ / Window.CONSTANTS.PPQ_tempo;
        var snap = Mouse.drag.grab;

        var quickCalc = (start, slope, timesig, extract) => {
            var C1 = (delta) => 60000.0 * (timesig) / (delta);
            var sigma = (start, constant) => (
                (n) => (1.0 / ((start * Window.CONSTANTS.PPQ_tempo * constant / 60000.0) + n))
            );

            let new_C = C1(slope);
            // convert extractions to ticks
            let extract_tick_locations = Object.keys(extract).reduce((acc, key) => ({ ...acc, [key]: extract[key] * Window.CONSTANTS.PPQ_tempo }), {});

            let returned = { beats: [], ticks: [] };
            returned.ms = new_C * tick_array.reduce((sum, __, i) => {
                Object.keys(extract_tick_locations).forEach(key => {
                    if (i === extract_tick_locations[key])
                        returned[key] = sum*new_C
                });
                return sum + sigma(start, new_C)(i);
            }, 0);
            // catch last beat
            Object.keys(extract_tick_locations).forEach(key => {
                if (extract_tick_locations[key] === (timesig * Window.CONSTANTS.PPQ_tempo))
                    returned[key] = returned.ms;
            });


            // default snap target to end if nowhere else
            if (!('snapped' in returned)) 
                returned.snapped = returned.ms;
            return returned;
        };


        // LENGTH GRADIENT DESCENT
        // let nudge = nudge_factory(measure, crowd.end[0], measure.timesig, 0, 0);
        var nudge_factory = (measure, target, snap, beat_lock, locks, type) => {
            var start = measure.temp.start || measure.start;
            var end = measure.temp.end || measure.end;
            var slope = end - start;
            var offset = measure.temp.offset || measure.offset;
            var ms = measure.temp.ms || measure.ms;



            let nudge = (gap, alpha, depth, even) => {
                if (depth > 99 || Math.abs(gap) < c.NUDGE_THRESHOLD) {
                    // last full calculation
                    let cumulative = 0;
                    let last = 0;
                    let inc = slope/measure.ticks.length;
                    let beats = [];
                    let ticks = [];
                    measure.ticks.forEach((__, i) => {
                        if (!(i%Window.CONSTANTS.PPQ))
                            beats.push(cumulative);
                        ticks.push(cumulative);
                        if (i%PPQ_mod === 0) 
                            last = K / (start + inc*i);
                        cumulative += last;
                    });
                    beats.push(cumulative);
                    return { start, end, slope, offset, ms: cumulative, beats, ticks, snap };
                }

                let delta = { start: alpha, end: alpha };
                // if start not locked
                if (!!(locks & (1 << 1)))
                    delta.start = 0;
                if (!!(locks & (1 << 2)))
                    delta.end = 0;

                if (type === 'rot_left')
                    delta.start *= -1;
                if (type === 'rot_right')
                    delta.end *= -1;


                start *= (gap > c.NUDGE_THRESHOLD) ?
                    (1 + delta.start) : (1 - delta.start);
                end *= (gap > c.NUDGE_THRESHOLD) ?
                    (1 + delta.end) : (1 - delta.end);
                slope = end - start;

                let calc_extracts = { snapped: snap };
                if (beat_lock)
                    Object.assign(calc_extracts, { locked: beat_lock.beat });
                let calc = quickCalc(start, slope, measure.timesig, calc_extracts);
                let { locked, snapped } = calc;

                if (typeof(locked) === 'number') {// && beat_lock.type === 'loc') {
                    // 'absolute' will shift everything around a locked point in absolute time
                    if ('absolute' in beat_lock)
                        offset = beat_lock.absolute - locked;
                    else
                        offset = measure.offset + measure.beats[beat_lock.beat] - locked;
                } else //if (even)
                    // make SURE offset gets updated - otherwise gap will never shorten when the first beat snaps!
                    offset += (ms - calc.ms)*0.5;

                ms = calc.ms;

                
                let new_gap = snapped + offset - target;
                console.log(snapped, offset, target);
                alpha = monitor(gap, new_gap, alpha);
                return nudge(new_gap, alpha, depth + 1, even);
            }

            return nudge;
        };

        // y-drag
        if (Mouse.drag.mode === 'tempo') {
            Mouse.drag.y += event.movementY;
            let spread = range.tempo[1] - range.tempo[0];
            let change = Mouse.drag.y / c.INST_HEIGHT * spread;
            var beat_lock = Object.keys(measure.locks).length ?
                ({ beat: parseInt(lock_candidates[0], 10), type: Window.selected.meas.locks[lock_candidates[0]] }) : {};
            
            if (beat_lock.beat !== Mouse.grabbed) {
                let slope = (measure.end - measure.start)/measure.timesig;
                let new_slope = slope*Mouse.grabbed - change;

                // if nothing is tempo-locked
                if (!('beat' in beat_lock) || beat_lock.type === 'loc') {
                    console.log('path 1');
                    let update = {
                        start: measure.start - (!(locks & 1 << 1) ? change : 0),
                        end: measure.end - (!(locks & 1 << 2) ? change : 0),
                        offset: measure.offset,
                        beats: [],
                        ticks: []
                    }


                    if (update.start < 10 || update.end < 10)
                        return;

                    if (!crowd_cache)
                        crowd_cache = crowding(measure.gaps, measure.offset, measure.ms, { strict: true });
                    let crowd = crowd_cache;

                    update.slope = update.end - update.start;
                    let inc = (update.end - update.start)/measure.ticks.length;
                    let cumulative = 0.0;
                    let last = 0;


                    measure.ticks.forEach((__, i) => {
                        if (!(i%Window.CONSTANTS.PPQ))
                            update.beats.push(cumulative);
                        update.ticks.push(cumulative);
                        if (i%PPQ_mod === 0) 
                            last = K / (update.start + inc*i);
                        cumulative += last;
                    });
                    update.beats.push(cumulative);


                    if ('beat' in beat_lock)
                        update.offset = measure.offset + measure.beats[beat_lock.beat] - update.beats[beat_lock.beat]
                    else
                        update.offset += (measure.ms - cumulative)/2; 

                    Object.assign(update, { ms: cumulative });

                    // check if the adjustment crowds the previous or next measures
                    if (update.offset < crowd.start[0] + c.SNAP_THRESHOLD) {
                        // check if a segment up to a loc-locked beat is filled
                        if ('beat' in beat_lock && beat_lock.type === 'loc') {
                            if (!nudge_cache) {
                                measure.temp.offset = update.offset;
                                // the strategy with this nudge is to lock the updated offset,
                                // overshoot the snapped beat, then shift the nudged measure offset
                                // backwards to correct.
                                let nudge = nudge_factory(measure, measure.offset + measure.beats[beat_lock.beat] + (measure.offset-crowd.start[0]), beat_lock.beat, { beat: 0, type: 'loc' }, 0, 0);
                                nudge_cache = nudge(update.offset - crowd.start[0], 0.01, 0);
                                // correct for offset
                                nudge_cache.offset = crowd.start[0];
                            }
                            Object.assign(update, nudge_cache);
                        } else
                            update.offset = crowd.start[0];
                    } else if (update.offset + cumulative > crowd.end[0] - c.SNAP_THRESHOLD) {
                        // check for interference with the next measure
                        if ('beat' in beat_lock && beat_lock.type === 'loc') {
                            if (!nudge_cache) {
                                update.offset = crowd.end[0];
                                measure.temp.offset = update.offset;
                                let nudge = nudge_factory(measure, measure.offset + measure.beats[beat_lock.beat], beat_lock.beat, { beat: measure.timesig, type: 'loc', absolute: crowd.end[0] }, 0, 0);
                                nudge_cache = nudge(crowd.end[0] - update.offset - cumulative, 0.01, 0);
                            }
                            Object.assign(update, nudge_cache);
                        } else
                            update.offset = crowd.end[0] - cumulative;
                    }

                    let exemption = null;
                    if ('beat' in beat_lock)
                        exemption = beat_lock.beat;
                    let close = snap_eval(update.offset, update.beats, exemption);
                    let gap = close.target - (update.beats[close.index] + update.offset);

                    // if snap target changes, recalculate nudge_cache
                    if (nudge_cache && nudge_cache.snap !== close.index)
                        nudge_cache = false;


                    // NEED TO COPY THIS TO 'tempo'/beat_lock === 'tempo'/'both' section below
                    // - get tempo lock to push against the sides of adjacent measures with no 'loc' lock
                    if (cumulative > crowd.end[0] - crowd.start[0]) {
                        update.offset = crowd.start[0];
                        if (!nudge_cache) {
                            measure.temp.offset = update.offset;
                            // nudge factory - fill gap
                            let nudge = nudge_factory(measure, crowd.end[0], measure.timesig, 0, 0);
                            nudge_cache = nudge(crowd.end[0] - (crowd.start[0] - cumulative), 0.01, 0);
                        }
                        Object.assign(update, nudge_cache);
                    } else if (Math.abs(gap) < c.SNAP_THRESHOLD/2) {
                        console.log('snapping ', close.index, gap);
                        if (!nudge_cache) {
                            measure.temp.offset = update.offset;
                            let nudge = nudge_factory(measure, close.target, close.index, 
                                ('beat' in beat_lock) ? beat_lock : null,
                            0);
                            nudge_cache = nudge(gap, 0.01, 0);
                        };
                        Object.assign(update, nudge_cache);
                    } else
                        nudge_cache = false;
                        
                    let temprange = [Math.min(update.start, range.tempo[0]), Math.max(update.end, range.tempo[1])];
                    Object.assign(range, { temprange });
                    Object.assign(measure.temp, update);
                    return;

                //} else if (beat_lock.type === 'tempo') {

                // this should work for type === 'both' - DRY this up later
                } else if (beat_lock.type) {

                    let pivot = (measure.end - measure.start)/measure.timesig * beat_lock.beat;
                    let fresh_slope = (new_slope - pivot) / (Mouse.grabbed - beat_lock.beat);
                    let temp_start = (new_slope + measure.start) - fresh_slope*Mouse.grabbed;
                    let inc = fresh_slope/Window.CONSTANTS.PPQ;

                    
                    let cumulative = 0.0;
                    //let K = 60000.0 / Window.CONSTANTS.PPQ;
                    let last = 0;

                    let new_beats = [];
                    let new_ticks = [];
                    measure.ticks.forEach((__, i) => {
                        if (!(i%Window.CONSTANTS.PPQ))
                            new_beats.push(cumulative);
                        new_ticks.push(cumulative);
                        if (i%PPQ_mod === 0) 
                            last = K / (temp_start + inc*i);
                        cumulative += last;
                    });
                    new_beats.push(cumulative);

                    let temp_offset = measure.offset;
                    if (beat_lock.type === 'tempo')
                        temp_offset += (measure.ms*0.5 - cumulative*0.5)
                    else if (beat_lock.type === 'both')
                        temp_offset += (measure.beats[beat_lock.beat] - new_beats[beat_lock.beat]);
                    
                    let crowd = crowding(measure.gaps, temp_offset, cumulative);

                    let update = {
                        start: temp_start,
                        slope: fresh_slope * measure.timesig,
                        offset: temp_offset
                    };

                    // skip if not dragged far enough or already in conflict with adjacent measures
                    if (Math.abs(temp_offset - measure.offset) < 5.0 ||
                        (!nudge_cache && (crowd.start[1] < 0 || crowd.end[1] < 0))
                    ) {
                        Object.assign(measure.temp, measure);
                        delete range.temprange;
                        return;
                    }
                    

                    let lock_candidates = Object.keys(measure.locks).map(key => parseInt(key, 10));
                    var beat_lock = lock_candidates.length ?
                        ({ beat: lock_candidates[0], type: Window.selected.meas.locks[lock_candidates[0]] }) : {};
                    console.log(beat_lock);

                    let close = snap_eval(update.offset, new_beats, beat_lock.beat);
                    let gap = close.target - (new_beats[close.index] + update.offset);

                    if (measure.offset > (crowd.start[0] + c.NUDGE_THRESHOLD)
                        && crowd.start[1] < c.SNAP_THRESHOLD
                    ) {
                        console.log('Path 1');
                        if (!nudge_cache) {
                            measure.temp.start = temp_start;
                            // nudge factory - tempo change, beat is locked, snap to previous measure
                            let nudge = nudge_factory(measure, crowd.start[0], 0, 
                                (beat_lock.type === 'both') ? beat_lock : null, 
                            locks, 'rot_left');
                            nudge_cache = nudge(crowd.start[1], 0.01, 0);
                        }
                    } else if ((measure.offset + measure.ms) < (crowd.end[0] - c.NUDGE_THRESHOLD)
                        && crowd.end[1] < c.SNAP_THRESHOLD
                    ) {

                        console.log('Path 2');
                        if (!nudge_cache) {
                            measure.temp.start = temp_start;

                            // nudge factory - tempo change, beat is locked, snap to previous measure
                            let nudge = nudge_factory(measure, crowd.end[0], measure.timesig, /*beat_lock*/ null, locks, 'rot_right');
                            nudge_cache = nudge(crowd.end[1], 0.001, 0);
                        }
                    // MESSYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
                    // THIS MIGHT JUST BE A BAD FEATURE IDK
                    } else if (close.index !== -1 && Math.abs(gap) < c.SNAP_THRESHOLD) {
                        if (!nudge_cache) {
                            measure.temp.start = temp_start;
                            let type = (gap > 0) ? 'rot_right' : 'rot_left';
                            let nudge = nudge_factory(measure, close.target, close.index,
                                (beat_lock.type === 'both') ? beat_lock : null, 
                            locks, type);
                            nudge_cache = nudge(gap, 0.001, 0);
                        }
                    } else
                        nudge_cache = false;

                    if (nudge_cache) 
                        Object.assign(update, nudge_cache);


                    new_beats = [];
                    new_ticks = [];
                    cumulative = 0.0;
                    last = 0;
                    inc = update.slope / (Window.CONSTANTS.PPQ * measure.timesig);
                    
                    measure.ticks.forEach((__, i) => {
                        if (!(i%Window.CONSTANTS.PPQ))
                            new_beats.push(cumulative);
                        new_ticks.push(cumulative);
                        if (i%PPQ_mod === 0) 
                            last = K / (update.start + inc*i);
                        cumulative += last;
                    });
                    new_beats.push(cumulative);


                    update.end = update.start + update.slope;
                    update.ticks = new_ticks;
                    update.beats = new_beats;
                    update.ms = cumulative;
                    if ('beat' in beat_lock && beat_lock.type === 'both')
                        update.offset = measure.offset + measure.beats[beat_lock.beat] - new_beats[beat_lock.beat];
                    let temprange = [Math.min(update.start, range.tempo[0]), Math.max(update.end, range.tempo[1])];
                    Object.assign(range, { temprange });

                    Object.assign(measure.temp, update);
                }
            }

            API.updateEdit(measure.temp.start, measure.temp.end, measure.timesig, measure.temp.offset);
            return;
        }

      
        Mouse.drag.x += event.movementX;
        if (Math.abs(Mouse.drag.x) < c.DRAG_THRESHOLD_X) {
            //delete measure.temp;
            return;
        } 

        if (Mouse.drag.mode === 'measure') {
            let position = measure.offset + Mouse.drag.x/Window.scale;
            let close = snap_eval(position, measure.beats);

            // determine whether start or end are closer
            // negative numbers signify conflicts
            let crowd = crowding(measure.gaps, position, measure.ms);
            let update = {
                ticks: measure.ticks.slice(0),
                beats: measure.beats.slice(0),
                offset: position
            };

            // initialize flag to prevent snapping when there's no space anyways
            let check_snap = true;
            if (Math.abs(crowd.start[1]) < Math.abs(crowd.end[1])) {
                if (crowd.start[1] - c.SNAP_THRESHOLD*2 < 0) {
                    update.offset = crowd.start[0];
                    check_snap = false;
                }
            } else {
                if (crowd.end[1] - c.SNAP_THRESHOLD*2 < 0) {
                    update.offset = crowd.end[0] - measure.ms;
                    check_snap = false;
                }
            }

            if (check_snap && close.index !== -1) {
                let gap = close.target - (measure.beats[close.index] + position);
                if (Math.abs(gap) < 50) {
                    snaps.snapped_inst = { ...close, origin: Window.selected.inst };
                    update.offset = position + gap;
                } else
                    snaps.snapped_inst = {};
            };
            
            Object.assign(measure.temp, update);
            return;
        };

        

        let beatscale = (-Mouse.drag.x*Window.scale); // /p.width

        // divide this by scale? depending on zoom?
        let slope = measure.end - measure.start;
        var temp_start;

        let perc = Math.abs(slope) < c.FLAT_THRESHOLD ?
            ((Window.selected.dir === 1) ? -c.FLAT_THRESHOLD : c.FLAT_THRESHOLD) :
            Mouse.grabbed/Math.abs(slope);

        let amp_lock = beatscale/perc;


        // if START is locked
        // change slope, preserve start
        if (locks & (1 << 1)) {
            slope += amp_lock;
            temp_start = measure.start;
        }
        // if END is locked
        // change slope, preserve end by changing start to compensate
        else if (locks & (1 << 2)) {
            slope -= amp_lock;
            temp_start = measure.start + amp_lock;
        // if SLOPE is locked
        // split change between start and end
        } else if (locks & (1 << 4)) {
            //slope += amp_lock/2; 
            temp_start = measure.start + amp_lock;
        } else {
            slope += amp_lock/2; 
            temp_start = measure.start + amp_lock/2;
        };


        let { ms, locked, grabbed } = quickCalc(temp_start, slope, measure.timesig, { locked: beat_lock.beat, grabbed: snap });

        if (Math.abs(ms - measure.ms) < c.DRAG_THRESHOLD_X) {
            measure.temp.offset = measure.offset;
            measure.temp.start = measure.start;
            slope = measure.end - measure.start;
            return;
        };


        let temp_offset = locked ?
            measure.offset + measure.beats[beat_lock.beat] - locked :
            measure.offset;

        let loc = grabbed + temp_offset;


        // check for overlaps
        let crowd = crowding(measure.gaps, temp_offset, ms);
        if (crowd.start[1] < 0 || crowd.end[1] < 0)
            return;

        let snap_to = closest(loc, Window.selected.inst, snaps.div_index).target;
        
        let gap = loc - snap_to;

        if (Math.abs(gap) < c.SNAP_THRESHOLD) {
            // if initial snap, update measure.temp.start 
            // for the last time and nudge.
            if (!nudge_cache) {
                measure.temp.start = temp_start;

                // nudge factory - tick mouse drag, snap to adjacent measure beats
                //
                let nudge = nudge_factory(measure, snap_to, snap, beat_lock, locks); 
                nudge_cache = nudge(gap, 0.001, 0);
                Object.assign(measure.temp, nudge_cache);
            };
            Object.assign(measure.temp, nudge_cache);
        } else {
            nudge_cache = false;
            measure.temp.start = temp_start;
            measure.temp.slope = slope;
        }

                   
        // INVERT THIS DRAG AT SOME POINT?

        var SNAP_THRESH = 2.0;

        // if DIRECTION is locked
        if (locks & (1 << 3)) {
            // flat measure can't change direction
            if (!Window.selected.dir)
                return;
            if (measure.temp.slope * Window.selected.dir < SNAP_THRESH) {
                measure.temp.slope = 0;
                if (locks & (1 << 2))
                    measure.temp.start = measure.end;
                else if (locks & (1 << 1))
                    measure.temp.end = measure.start;
            }
            /*inc = (Window.selected.dir === 1) ?
                Math.max(inc, 0) : inc;
            if (locks & (1 << 2))
                measure.temp.start = (Window.selected.dir === 1) ?
                    Math.min(measure.temp.start, measure.end) :
                    Math.max(measure.temp.start, measure.end);
                    */
        };

        let inc = measure.temp.slope/measure.ticks.length;
        let cumulative = 0.0;
        //let K = 60000.0 / Window.CONSTANTS.PPQ;
        let last = 0;

        let new_beats = [];
        let new_ticks = [];
        measure.ticks.forEach((__, i) => {
            if (!(i%Window.CONSTANTS.PPQ))
                new_beats.push(cumulative);
            new_ticks.push(cumulative);
            if (i%PPQ_mod === 0) 
                last = K / (measure.temp.start + inc*i);
            cumulative += last;
        });
        new_beats.push(cumulative);


        measure.temp.end = measure.temp.start + measure.temp.slope;
        measure.temp.ms = cumulative;
        measure.temp.offset = measure.offset;
        if ('beat' in beat_lock)
            measure.temp.offset += measure.beats[beat_lock.beat] - new_beats[beat_lock.beat];

        Object.assign(range, { temprange: [
            Math.min(measure.temp.start, range.tempo[0]),
            Math.max(measure.temp.end, range.tempo[1])
        ] });

        measure.temp.ticks = new_ticks;
        measure.temp.beats = new_beats;

    };

    p.mouseReleased = function(event) {
        p.mouseDown = false;
        if (Mouse.outside_origin) {
            Mouse.drag.mode = '';
            return;
        }

        if (Mouse.drag.mode === 'lock') {
            Window.lockConfirm(Window.selected.meas, Mouse.lock_type);
            Object.assign(Mouse.drag, { x: 0, y: 0, mode: '' });
            return;
        }

        nudge_cache = false;
        crowd_cache = false;

        if (p.mouseY < 0 || p.mouseY > p.height) {
            Mouse.drag.mode = '';
            return;
        }
        
        // handle threshold
        if (Math.abs(Mouse.drag.x) < c.DRAG_THRESHOLD_X &&
            Math.abs(Mouse.drag.y) < c.DRAG_THRESHOLD_X
        ) {
            if (Window.selected.meas)
                delete Window.selected.meas.temp;
            Object.assign(Mouse.drag, { x: 0, y: 0, mode: '' });
            return;
        };

        if (!(Window.selected.meas)) {
            Mouse.drag.mode = '';
            return;
        }

        let measure = Window.selected.meas;
        range.tempo = range.temprange;
        delete range.temprange;

        if (Mouse.drag.mode === 'tempo') {
            API.updateMeasure(Window.selected.inst, Window.selected.meas.id, measure.temp.start, measure.temp.end, measure.beats.length - 1, measure.temp.offset);
            delete Window.selected.meas.temp;
            Object.assign(Mouse.drag, { x: 0, y: 0, mode: '' });
            return;
        };

        if (Mouse.drag.mode === 'measure') {
            API.updateMeasure(Window.selected.inst, Window.selected.meas.id, measure.start, measure.end, measure.beats.length - 1, measure.temp.offset);
            Object.assign(Mouse.drag, { x: 0, y: 0, mode: '' });
            return;
        };

        if (Mouse.drag.mode === 'tick') {
            let end = measure.temp.start + measure.temp.slope;
            measure.temp.ticks = [];
            Object.assign(Mouse.drag, { x: 0, y: 0, mode: '' });
            if (end < 10)
                return;
            
            API.updateMeasure(Window.selected.inst, Window.selected.meas.id, measure.temp.start, end, measure.beats.length - 1, measure.temp.offset);
        };
    }

    p.mouseMoved = function(event) {
        if (p.mouseX > 0 && p.mouseX < p.width &&
            p.mouseY > 0 && p.mouseY < p.height
        ) {
            //////////////////////////////////////
            let meta = {};
            if (API.pollSelecting())
                meta.insertMeas = Window.insertMeas.temp_offset;
            API.newCursor((p.mouseX - Window.viewport - c.PANES_WIDTH)/Window.scale, meta);
        }
        return false;
    };
    
}

