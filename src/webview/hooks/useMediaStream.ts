import { useEffect, useRef, useCallback, useState } from 'react';
import { usePipelineStore } from './usePipelineState';

export function useMediaStream(canvasRef: React.RefObject<HTMLCanvasElement>) {
    const currentFrame = usePipelineStore((state) => state.currentFrame);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [frameRendered, setFrameRendered] = useState(false);
    const lastRenderedFrame = useRef<string | null>(null);

    const renderFrame = useCallback((frameData: string) => {
        const canvas = canvasRef.current;
        if (!canvas) {
            // Canvas not available yet, will retry on next effect
            return false;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        if (!imageRef.current) {
            imageRef.current = new Image();
        }

        const img = imageRef.current;
        img.onload = () => {
            const cvs = canvasRef.current;
            const context = cvs?.getContext('2d');
            if (!cvs || !context) return;
            
            if (cvs.width !== img.width || cvs.height !== img.height) {
                cvs.width = img.width;
                cvs.height = img.height;
            }
            context.drawImage(img, 0, 0);
            setFrameRendered(true);
        };
        img.src = `data:image/jpeg;base64,${frameData}`;
        lastRenderedFrame.current = frameData;
        return true;
    }, [canvasRef]);

    // Try to render when frame or canvas changes
    useEffect(() => {
        if (currentFrame) {
            renderFrame(currentFrame);
        } else {
            setFrameRendered(false);
            lastRenderedFrame.current = null;
        }
    }, [currentFrame, renderFrame]);

    // Retry rendering if canvas wasn't ready before
    useEffect(() => {
        if (currentFrame && canvasRef.current && lastRenderedFrame.current !== currentFrame) {
            renderFrame(currentFrame);
        }
    });

    return {
        hasFrame: frameRendered
    };
}

export function useAudioStream() {
    const audioContextRef = useRef<AudioContext | null>(null);

    const initAudio = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }
        return audioContextRef.current;
    }, []);

    const playAudioSamples = useCallback((samples: Float32Array, sampleRate: number) => {
        const ctx = initAudio();
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        const channelData = new Float32Array(samples.length);
        channelData.set(samples);
        buffer.copyToChannel(channelData, 0);
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();
    }, [initAudio]);

    useEffect(() => {
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    return {
        playAudioSamples
    };
}

