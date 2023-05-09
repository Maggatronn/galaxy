export { initAudio, getDeviceNames, createVoice, gainsFromPan };

var audioCtx = null;

function setDeviceChannels(ctx) {
  // set output to 6 channels if possible, for 5.1
  // as of 2023.05.02, chrome and firefox don't seem to work with more
  // than 6 channels, but safari works. Probably not too terrible if the
  // top channels don't work for this, and it simplifies the panning
  // as of 2023.05.09 it seems that chrome gets unhappy if you try to set
  // ctx.destination.channelCount to less than the max
  ctx.destination.channelCount = ctx.destination.maxChannelCount;
  ctx.destination.channelInterpretation = "discrete";
}

async function setupAudioDevice(ctx, deviceName) {
  const devs = await navigator.mediaDevices.enumerateDevices();
  if(deviceName == "default") {
    console.log("Using default audio device");
    setDeviceChannels(ctx);
    return
  }
  for (const d of devs) {
    if (d.kind == "audiooutput" && d.label == deviceName) {
      await ctx.setSinkId(d.deviceId);
      console.log("Audio device set to \"" + deviceName + "\"")
      setDeviceChannels(ctx);
      return;
    }
  }
  throw Error("Audio Device \"" + deviceName + "\" not found");
}

// Note that this function needs to be called AFTER the user has interacted
// with the page, so it should be triggered from a button or something.
async function initAudio(deviceName) {
  // need to get permissions if we haven't already, to access all the devices
  await navigator.mediaDevices.getUserMedia({ audio: true });
  if (audioCtx) { console.warn("initAudio called multiple times, can't guarantee everything will get cleaned up"); }
  audioCtx = new AudioContext();
  setupAudioDevice(audioCtx, deviceName);
}

async function getDeviceNames() {
  // need to get permissions in order to see all the devices
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const devs = await navigator.mediaDevices.enumerateDevices();
  // print the device names
  return devs.filter(d => d.kind == "audiooutput").map(d => d.label);
}

function coords_to_string(coords) { return "(" + coords.x + ", " + coords.y + ")" }

function createVoice(url, listenerCoords, voiceCoords, listenRadius) {
  console.log("New voice at " + url)
  console.log("listener coords: " + coords_to_string(listenerCoords))
  console.log("voice coords: " + coords_to_string(voiceCoords))
  const mediaElement = new Audio(url);
  // if we want to load audio from a different host (e.g. running the site from
  // localhost and pulling from LVN), then we need to use CORS, which isn't used
  // unless we set the crossOrigin property
  mediaElement.crossOrigin = "anonymous";
  const elemNode = new MediaElementAudioSourceNode(audioCtx, {mediaElement});
  const panner = createPanner(audioCtx, audioCtx.destination);
  elemNode.connect(panner.input);
  const ret = {
    set listenerCoords(xy) {
      this._listenerCoords = xy;
      this._updatePanner();
    },
    set voiceCoords(xy) {
      this._voiceCoords = xy;
      this._updatePanner();
    },
    set volume(v) {
      this._volume = v;
      this._updatePanner();
    },
    pause: function() {
      this._volume = 0;
      this._updatePanner();
      // pause in 5 seconds, which should be enough time for a fadeout
      setTimeout(()=>mediaElement.pause(), 5000)
    },
    play: () => mediaElement.play(),
    _updatePanner: function() {
      this._panner.pan = panFromCoords(this._listenerCoords, this._voiceCoords);
      this._panner.gain = this._volume * gainFromCoords(this._listenerCoords, this._voiceCoords, this._listenRadius);
    },
    url,
    _volume: 1,
    _elem: mediaElement,
    _elemNode: elemNode,
    _panner: panner,
    _listenRadius: listenRadius,
    _listenerCoords: listenerCoords,
    _voiceCoords: voiceCoords
  }
  ret._updatePanner();
  return ret
}

// modulo (always has the same sign as `d`)
function mod(n, d) { return ((n % d) + d) % d }

// this arcane incantation creates an array from 0 to N-1
function zeroTo(N) { return Array.from({length: N}, (_, i) => i) };

// map over the values of an object, returning a new object with the same keys
function mapObj(o, f) {
  const ret = {};
  for(const [k, v] of Object.entries(o)) {
    ret[k] = f(v);
  }
  return ret;
}

// return the indices of the minimum and maximum values, skipping over any `null`s
function argExtrema(a) {
  let maxIdx = null;
  let minIdx = null;
  for(let i = 0; i < a.length; ++i) {
    if(a[i] === null) continue;
    if(maxIdx === null || a[i] > a[maxIdx]) maxIdx = i;
    if(minIdx === null || a[i] < a[minIdx]) minIdx = i;
  }
  return {minIdx, maxIdx};
}

// get the gain based on a linear (equal-amplitude) pan law
// given the normalized distance from the speaker to the source (i.e. 
// normDist == 1 means the source is at the other speaker of the pair)
function equalAmpPan(normDist) { return 1-normDist }
function equalPowPan(normDist) { return Math.cos(normDist * Math.PI/2) }

function gainsFromPan(theta, spkTheta) {
    // first we rotate all the speaker to be relative to the given direction,
    // with all angles wrapped to [0, 360)
    const spkThetaRel = spkTheta.map(t => t === null ? null : mod(t - theta, 360));
    // because the target vector is at 0, the first speaker to the right has the
    // minimum angle, and the first speaker to the left has the maximum angle
    const {minIdx: rSpk, maxIdx: lSpk} = argExtrema(spkThetaRel);
    // get the distance (in degrees) between the L and R speakers of the pair
    const spkDist = mod(spkThetaRel[rSpk] - spkThetaRel[lSpk], 360);
    return spkThetaRel.map((t, i) => {
      // if we're one of the two speaker of the pair, compute the pan gain
      if(i == lSpk) return equalPowPan((360-t) / spkDist);
      if(i == rSpk) return equalPowPan(t / spkDist);
      // otherwise the gain is 0
      return 0.0;
    })
}

function panFromCoords(listenerCoords, voiceCoords) {
  /*
   * coordinates have (0,0) at the top-left and increase down and right.
   * This implies that positive angles should go clockwise (left-handed).
   * We'll set 0deg to the +x axis, so straight forward is 90deg
   */
    return Math.atan2(
      voiceCoords.y - listenerCoords.y,
      voiceCoords.x - listenerCoords.x) / Math.PI * 180;
}

function gainFromCoords(listenerCoords, voiceCoords, listenRadius) {
  const dist = Math.sqrt(
    (voiceCoords.x - listenerCoords.x) ** 2 +
    (voiceCoords.y - listenerCoords.y) ** 2);
  let gain;
  if(dist < listenRadius) {
    gain = 1;
  } else {
    gain = listenRadius / dist;
  }
  console.log("distance: " + dist + ", gain: " + gain);
  return gain;
}

// assume a standard speaker layout given the channel count
function spkLayoutFromNChans(nChans) {
  if(nChans == 6) {
    // assume standard 5.1 layout
    // in degrees, listed in channel order
    return [
      -90 - 30,  // L
      -90 + 30,  // R
      -90,       // C
      null,      // LFE
      -90 - 115, // Ls
      -90 + 115] // Rs
  } else if(nChans == 2) {
    return [-90-30, -90+30];
  } else {
    throw Error("Only 5.1 (6-channel) and stereo (2-channel) configurations currently supported")
  }
}

/* 
 * Build a multichannel surround panner.
 */
function createPanner(ctx, destNode) {
  const merger = new ChannelMergerNode(ctx, {numberOfInputs: destNode.channelCount,
                                             channelInterpretation: "discrete"});
  merger.connect(destNode);
  const nChans = Math.min(destNode.channelCount, 6);
  console.log("Creaeting panner with " + nChans + " channels")
  // the fanout node is responsible for sending its input to all the separate
  // per-channel gain nodes. We force it to be mono so that any inputs will get
  // downmixed before we fan-out to the output channels. If we wanted to be
  // fancier we could handle a full mix matrix to pan/balance multichannel
  // signals, but not for now
  const fanout = new GainNode(ctx, {gain: 1, channelCount: 1, channelCountMode: "explicit"});
  // create 1 gain node for each channel
  const channelGainNodes = []
  for(let i = 0; i < nChans; ++i) {
  	const g = new GainNode(ctx, {gain: 0});
    channelGainNodes.push(g);
    g.connect(merger, 0, i);
    fanout.connect(g);
  }
  let spkTheta = spkLayoutFromNChans(nChans);
  const setPan = p => {
    gainsFromPan(p, spkTheta).map((gain, i) => {
      channelGainNodes[i].gain.setTargetAtTime(gain, ctx.currentTime, 0.1);
    });
    console.log("gains: " + gainsFromPan(p, spkTheta));
  }
  // initialize panner to straight-ahead (-90deg, because 0deg is to the right)
  setPan(-90);
  // keep references to all the nodes here, just to protect from garbage collection.
  // we expect users to only interact with `input` node and the `pan` function.
  return {
    input: fanout,
    merger,
    channelGains: channelGainNodes,
    // set the pan, where 0deg is to the right, so -90deg is straight ahead
    set pan(p) { setPan(p); },
    // set the overall gain, with a fade
    set gain(g) { fanout.gain.setTargetAtTime(g, ctx.currentTime, 1); }
  }
}