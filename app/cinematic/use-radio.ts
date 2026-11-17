'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { makeAudioMeter, type MeterFrame } from './audio-meter';

export type RadioStatus = 'stopped' | 'connecting' | 'playing' | 'error';
export type RadioReading =
  | { state: 'idle' | 'quiet' | 'parked' }
  | { state: 'waiting'; atRest: boolean }
  | { state: 'live'; frame: MeterFrame };
export type RadioSignal = {
  read: () => RadioReading;
};

type Graph = {
  context: AudioContext;
  meter: AnalyserNode;
  gain: GainNode;
  bins: Uint8Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
  dynamics: ReturnType<typeof makeAudioMeter>;
};
type Connection = {
  audio: HTMLAudioElement;
  node?: MediaElementAudioSourceNode;
  timer: number;
  stop: () => void;
};

function makeGraph(): Graph | undefined {
  const Constructor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return;
  const context = new Constructor();
  const meter = context.createAnalyser();
  const gain = context.createGain();
  meter.fftSize = 2048;
  meter.minDecibels = -86;
  meter.maxDecibels = -16;
  meter.smoothingTimeConstant = .17;
  meter.connect(gain).connect(context.destination);
  const bins = new Uint8Array(meter.frequencyBinCount);
  const waveform = new Float32Array(meter.fftSize);
  return { context, meter, gain, bins, waveform, dynamics: makeAudioMeter(context.sampleRate / meter.fftSize) };
}

export function useRadio(source: string) {
  const active = useRef<Connection | null>(null);
  const graph = useRef<Graph | undefined>(undefined);
  const currentStatus = useRef<RadioStatus>('stopped');
  const gainLevel = useRef(.82);
  const reading = useRef<RadioReading>({ state: 'idle' });
  const [status, setStatus] = useState<RadioStatus>('stopped');
  const [volume, setVolume] = useState(gainLevel.current);

  const signal = useRef<RadioSignal>({
    read: () => reading.current,
  }).current;

  function publish(value: RadioStatus) {
    currentStatus.current = value;
    setStatus(value);
  }

  function release() {
    const session = active.current;
    active.current = null;
    session?.stop();
    graph.current?.dynamics.reset();
  }

  function stop() {
    release();
    if (reading.current.state !== 'idle') reading.current = { state: 'parked' };
    publish('stopped');
  }

  function waitForSignal() {
    const { state } = reading.current;
    if (state !== 'waiting') reading.current = { state: 'waiting', atRest: state === 'parked' || state === 'quiet' };
  }

  function connect(useAnalysis: boolean) {
    let sound: Graph | undefined;
    if (useAnalysis) {
      try {
        graph.current ??= makeGraph();
        sound = graph.current;
      } catch {
        // Browsers without Web Audio still play the original stream.
      }
    }
    const audio = new Audio();
    let node: MediaElementAudioSourceNode | undefined;
    if (sound) {
      try {
        audio.crossOrigin = 'anonymous';
        node = sound.context.createMediaElementSource(audio);
        node.connect(sound.meter);
        sound.gain.gain.value = gainLevel.current;
        void sound.context.resume().catch(() => {});
      } catch {
        audio.removeAttribute('crossorigin');
        node?.disconnect();
        node = undefined;
      }
    }
    audio.preload = 'none';
    if (!node) audio.volume = gainLevel.current;
    let sampler = 0;
    let hadSignal = false;
    let lastSound = -Infinity;

    function sample() {
      if (active.current !== session || !node || !sound) return;
      const { context, meter, bins, waveform, dynamics } = sound;
      if (context.state !== 'running') {
        if (reading.current.state === 'live') dynamics.reset();
        waitForSignal();
        return;
      }
      meter.getFloatTimeDomainData(waveform);
      let squared = 0;
      for (let i = 0; i < waveform.length; i += 4) squared += waveform[i] ** 2;
      const now = performance.now();
      if (squared * 4 / waveform.length >= .00000072) {
        hadSignal = true;
        lastSound = now;
      }
      if (!hadSignal) return;
      if (now - lastSound > 430) {
        if (reading.current.state !== 'quiet') dynamics.reset();
        reading.current = { state: 'quiet' };
        return;
      }
      meter.getByteFrequencyData(bins);
      const measured = dynamics.read(bins, now);
      if (reading.current.state !== 'live') reading.current = { state: 'live', frame: measured };
    }

    const session: Connection = {
      audio,
      node,
      timer: 0,
      stop: () => {
        window.clearTimeout(session.timer);
        window.clearInterval(sampler);
        audio.removeEventListener('playing', playing);
        audio.removeEventListener('waiting', waiting);
        audio.removeEventListener('pause', interrupted);
        audio.removeEventListener('stalled', stalled);
        audio.removeEventListener('error', fail);
        audio.removeEventListener('ended', fail);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        node?.disconnect();
      },
    };

    function fail() {
      if (active.current !== session) return;
      release();
      if (node) {
        connect(false);
      } else {
        reading.current = { state: 'parked' };
        publish('error');
      }
    }

    function deadline() {
      window.clearTimeout(session.timer);
      session.timer = window.setTimeout(fail, 14000);
    }

    function playing() {
      if (active.current !== session) return;
      window.clearTimeout(session.timer);
      publish('playing');
      if (node && sound) {
        if (sound.context.state === 'suspended') void sound.context.resume().catch(() => {});
        sample();
        if (!sampler) sampler = window.setInterval(sample, 16);
      }
    }

    function interrupted() {
      if (active.current === session) stop();
    }

    function waiting() {
      if (active.current !== session) return;
      window.clearInterval(sampler);
      sampler = 0;
      waitForSignal();
      publish('connecting');
      deadline();
    }

    function stalled() {
      if (active.current === session && audio.readyState < 3 && currentStatus.current === 'playing') waiting();
    }

    active.current = session;
    waitForSignal();
    publish('connecting');
    audio.addEventListener('playing', playing);
    audio.addEventListener('waiting', waiting);
    audio.addEventListener('pause', interrupted);
    audio.addEventListener('stalled', stalled);
    audio.addEventListener('error', fail);
    audio.addEventListener('ended', fail);
    audio.src = source;
    deadline();
    void audio.play().catch(fail);
  }

  function play() {
    if (active.current) return;
    connect(true);
  }

  function changeVolume(value: number) {
    const next = Math.max(0, Math.min(1, value));
    gainLevel.current = next;
    setVolume(next);
    if (graph.current) {
      const { context, gain } = graph.current;
      gain.gain.setTargetAtTime(next, context.currentTime, .045);
    }
    if (active.current && !active.current.node) active.current.audio.volume = next;
  }

  const stopOnPageHide = useEffectEvent(stop);
  useEffect(() => {
    const hidden = () => stopOnPageHide();
    window.addEventListener('pagehide', hidden);
    return () => {
      window.removeEventListener('pagehide', hidden);
      release();
      void graph.current?.context.close().catch(() => {});
      graph.current = undefined;
    };
  }, []);

  return { status, volume, signal, play, stop, changeVolume };
}
