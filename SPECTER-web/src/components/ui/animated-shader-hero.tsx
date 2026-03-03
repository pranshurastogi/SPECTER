"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface HeroProps {
  trustBadge?: {
    text: string;
    icons?: string[];
  };
  headline: {
    line1: string;
    line2: string;
  };
  subtitle: string;
  buttons?: {
    primary?: {
      text: string;
      onClick?: () => void;
    };
    secondary?: {
      text: string;
      onClick?: () => void;
    };
  };
  className?: string;
  showContent?: boolean;
}

const useShaderBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const pointersRef = useRef<PointerHandler | null>(null);

  class WebGLRenderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private vs: WebGLShader | null = null;
    private fs: WebGLShader | null = null;
    private buffer: WebGLBuffer | null = null;
    private scale: number;
    private shaderSource: string;
    private mouseMove = [0, 0];
    private mouseCoords = [0, 0];
    private pointerCoords = [0, 0];
    private nbrOfPointers = 0;

    private vertexSrc = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`;

    private vertices = [-1, 1, -1, -1, 1, 1, 1, -1];

    constructor(canvas: HTMLCanvasElement, scale: number) {
      this.canvas = canvas;
      this.scale = scale;
      const gl = canvas.getContext("webgl2");
      if (!gl) {
        throw new Error("WebGL2 not supported");
      }
      this.gl = gl;
      this.gl.viewport(0, 0, canvas.width * scale, canvas.height * scale);
      this.shaderSource = defaultShaderSource;
    }

    updateShader(source: string) {
      this.reset();
      this.shaderSource = source;
      this.setup();
      this.init();
    }

    updateMove(deltas: number[]) {
      this.mouseMove = deltas;
    }

    updateMouse(coords: number[]) {
      this.mouseCoords = coords;
    }

    updatePointerCoords(coords: number[]) {
      this.pointerCoords = coords;
    }

    updatePointerCount(nbr: number) {
      this.nbrOfPointers = nbr;
    }

    updateScale(scale: number) {
      this.scale = scale;
      this.gl.viewport(0, 0, this.canvas.width * scale, this.canvas.height * scale);
    }

    compile(shader: WebGLShader, source: string) {
      const gl = this.gl;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
      }
    }

    test(source: string) {
      const gl = this.gl;
      const shader = gl.createShader(gl.FRAGMENT_SHADER);
      if (!shader) return "Failed to create shader";

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      const result = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
        ? null
        : gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      return result;
    }

    reset() {
      const gl = this.gl;
      if (this.program && !gl.getProgramParameter(this.program, gl.DELETE_STATUS)) {
        if (this.vs) {
          gl.detachShader(this.program, this.vs);
          gl.deleteShader(this.vs);
        }
        if (this.fs) {
          gl.detachShader(this.program, this.fs);
          gl.deleteShader(this.fs);
        }
        gl.deleteProgram(this.program);
      }
    }

    setup() {
      const gl = this.gl;
      this.vs = gl.createShader(gl.VERTEX_SHADER);
      this.fs = gl.createShader(gl.FRAGMENT_SHADER);
      if (!this.vs || !this.fs) return;

      this.compile(this.vs, this.vertexSrc);
      this.compile(this.fs, this.shaderSource);

      this.program = gl.createProgram();
      if (!this.program) return;

      gl.attachShader(this.program, this.vs);
      gl.attachShader(this.program, this.fs);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(this.program));
      }
    }

    init() {
      const gl = this.gl;
      if (!this.program) return;

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.STATIC_DRAW);

      const position = gl.getAttribLocation(this.program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      (this.program as WebGLProgram & Record<string, WebGLUniformLocation | null>).resolution =
        gl.getUniformLocation(this.program, "resolution");
      (this.program as WebGLProgram & Record<string, WebGLUniformLocation | null>).time =
        gl.getUniformLocation(this.program, "time");
      (this.program as WebGLProgram & Record<string, WebGLUniformLocation | null>).move =
        gl.getUniformLocation(this.program, "move");
      (this.program as WebGLProgram & Record<string, WebGLUniformLocation | null>).touch =
        gl.getUniformLocation(this.program, "touch");
      (this.program as WebGLProgram & Record<string, WebGLUniformLocation | null>).pointerCount =
        gl.getUniformLocation(this.program, "pointerCount");
      (this.program as WebGLProgram & Record<string, WebGLUniformLocation | null>).pointers =
        gl.getUniformLocation(this.program, "pointers");
    }

    render(now = 0) {
      const gl = this.gl;
      const program = this.program as (WebGLProgram & Record<string, WebGLUniformLocation | null>) | null;

      if (!program || gl.getProgramParameter(program, gl.DELETE_STATUS)) return;

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

      if (program.resolution) gl.uniform2f(program.resolution, this.canvas.width, this.canvas.height);
      if (program.time) gl.uniform1f(program.time, now * 1e-3);
      if (program.move) gl.uniform2f(program.move, ...this.mouseMove);
      if (program.touch) gl.uniform2f(program.touch, ...this.mouseCoords);
      if (program.pointerCount) gl.uniform1i(program.pointerCount, this.nbrOfPointers);
      if (program.pointers) gl.uniform2fv(program.pointers, this.pointerCoords);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  class PointerHandler {
    private scale: number;
    private active = false;
    private pointers = new Map<number, number[]>();
    private lastCoords = [0, 0];
    private moves = [0, 0];

    constructor(element: HTMLCanvasElement, scale: number) {
      this.scale = scale;

      const map = (x: number, y: number) => [x * this.scale, element.height - y * this.scale];

      element.addEventListener("pointerdown", (e) => {
        this.active = true;
        this.pointers.set(e.pointerId, map(e.clientX, e.clientY));
      });

      element.addEventListener("pointerup", (e) => {
        if (this.count === 1) this.lastCoords = this.first;
        this.pointers.delete(e.pointerId);
        this.active = this.pointers.size > 0;
      });

      element.addEventListener("pointerleave", (e) => {
        if (this.count === 1) this.lastCoords = this.first;
        this.pointers.delete(e.pointerId);
        this.active = this.pointers.size > 0;
      });

      element.addEventListener("pointermove", (e) => {
        if (!this.active) return;
        this.lastCoords = [e.clientX, e.clientY];
        this.pointers.set(e.pointerId, map(e.clientX, e.clientY));
        this.moves = [this.moves[0] + e.movementX, this.moves[1] + e.movementY];
      });
    }

    updateScale(scale: number) {
      this.scale = scale;
    }

    get count() {
      return this.pointers.size;
    }

    get move() {
      return this.moves;
    }

    get coords() {
      return this.pointers.size > 0 ? Array.from(this.pointers.values()).flat() : [0, 0];
    }

    get first() {
      return this.pointers.values().next().value || this.lastCoords;
    }
  }

  const resize = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = rect?.width ?? window.innerWidth;
    const height = rect?.height ?? 320;
    const dpr = Math.max(1, 0.5 * window.devicePixelRatio);

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (rendererRef.current) rendererRef.current.updateScale(dpr);
    if (pointersRef.current) pointersRef.current.updateScale(dpr);
  };

  const loop = (now: number) => {
    if (!rendererRef.current || !pointersRef.current) return;

    rendererRef.current.updateMouse(pointersRef.current.first);
    rendererRef.current.updatePointerCount(pointersRef.current.count);
    rendererRef.current.updatePointerCoords(pointersRef.current.coords);
    rendererRef.current.updateMove(pointersRef.current.move);
    rendererRef.current.render(now);

    animationFrameRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const dpr = Math.max(1, 0.5 * window.devicePixelRatio);

    try {
      rendererRef.current = new WebGLRenderer(canvas, dpr);
    } catch {
      return;
    }

    pointersRef.current = new PointerHandler(canvas, dpr);

    rendererRef.current.setup();
    rendererRef.current.init();
    resize();

    if (rendererRef.current.test(defaultShaderSource) === null) {
      rendererRef.current.updateShader(defaultShaderSource);
    }

    loop(0);
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      rendererRef.current?.reset();
    };
  }, []);

  return canvasRef;
};

const AnimatedShaderHero: React.FC<HeroProps> = ({
  trustBadge,
  headline,
  subtitle,
  buttons,
  className = "",
  showContent = true,
}) => {
  const canvasRef = useShaderBackground();

  return (
    <div className={cn("relative w-full min-h-[220px] overflow-hidden bg-black", className)}>
      <style>{`
        @keyframes shader-fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .shader-fade-up { animation: shader-fade-up .7s ease-out forwards; opacity: 0; }
      `}</style>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none object-cover"
        style={{ background: "black" }}
      />

      {showContent && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-4 text-white">
          {trustBadge && (
            <div className="mb-6 shader-fade-up">
              <div className="flex items-center gap-2 rounded-full border border-orange-300/30 bg-orange-500/10 px-4 py-2 text-sm backdrop-blur-md">
                {trustBadge.icons?.map((icon, index) => (
                  <span key={`${icon}-${index}`} className="text-amber-300">
                    {icon}
                  </span>
                ))}
                <span className="text-orange-100">{trustBadge.text}</span>
              </div>
            </div>
          )}

          <div className="mx-auto max-w-4xl space-y-4 text-center">
            <h1 className="shader-fade-up text-3xl font-bold text-transparent sm:text-5xl lg:text-6xl bg-gradient-to-r from-orange-300 via-yellow-400 to-amber-300 bg-clip-text">
              {headline.line1}
            </h1>
            <h1 className="shader-fade-up text-3xl font-bold text-transparent sm:text-5xl lg:text-6xl bg-gradient-to-r from-yellow-300 via-orange-400 to-red-400 bg-clip-text">
              {headline.line2}
            </h1>
            <p className="shader-fade-up mx-auto max-w-2xl text-sm text-orange-100/90 sm:text-lg">
              {subtitle}
            </p>

            {(buttons?.primary || buttons?.secondary) && (
              <div className="shader-fade-up mt-4 flex flex-col justify-center gap-3 sm:flex-row">
                {buttons.primary && (
                  <button
                    onClick={buttons.primary.onClick}
                    className="rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 px-6 py-2.5 font-semibold text-black transition-transform duration-300 hover:scale-[1.02]"
                  >
                    {buttons.primary.text}
                  </button>
                )}
                {buttons.secondary && (
                  <button
                    onClick={buttons.secondary.onClick}
                    className="rounded-full border border-orange-300/30 bg-orange-500/10 px-6 py-2.5 font-semibold text-orange-100 transition-colors duration-300 hover:bg-orange-500/20"
                  >
                    {buttons.secondary.text}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const defaultShaderSource = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)
float rnd(vec2 p){p=fract(p*vec2(12.9898,78.233));p+=dot(p,p+34.56);return fract(p.x*p.y);} 
float noise(in vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);float a=rnd(i),b=rnd(i+vec2(1,0)),c=rnd(i+vec2(0,1)),d=rnd(i+1.);return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);} 
float fbm(vec2 p){float t=.0,a=1.;mat2 m=mat2(1.,-.5,.2,1.2);for(int i=0;i<5;i++){t+=a*noise(p);p*=2.*m;a*=.5;}return t;} 
float clouds(vec2 p){float d=1.,t=.0;for(float i=.0;i<3.;i++){float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);t=mix(t,d,a);d=a;p*=2./(i+1.);}return t;} 
void main(void){vec2 uv=(FC-.5*R)/MN,st=uv*vec2(2,1);vec3 col=vec3(0);float bg=clouds(vec2(st.x+T*.5,-st.y));uv*=1.-.3*(sin(T*.2)*.5+.5);for(float i=1.;i<12.;i++){uv+=.1*cos(i*vec2(.1+.01*i,.8)+i*i+T*.5+.1*uv.x);vec2 p=uv;float d=length(p);col+=.00125/d*(cos(sin(i)*vec3(1,2,3))+1.);float b=noise(i+p+bg*1.731);col+=.002*b/length(max(p,vec2(b*p.x*.02,p.y)));col=mix(col,vec3(bg*.25,bg*.137,bg*.05),d);}O=vec4(col,1.);} `;

export default AnimatedShaderHero;
