import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

interface LiquidMetalButtonProps {
  label?: string;
  onClick?: () => void;
  /** When set, the button renders as an anchor (opens in a new tab). */
  href?: string;
  /** Optional leading icon shown before the label in text mode. */
  icon?: React.ReactNode;
  viewMode?: "text" | "icon";
  /** Overall pill height in px (default 40 — a touch smaller than the original 46). */
  height?: number;
  /** Explicit width in px. If omitted in text mode, it's measured from the label. */
  width?: number;
}

/* SPECTER gold theme — calm metallic gold instead of a harsh saturated yellow.
   Low tint alpha keeps the gold subtle so it reads as frosted glass, not a slab. */
const GOLD_TINT: [number, number, number, number] = [0.831, 0.686, 0.216, 0.5]; // #D4AF37, subtle
const DARK_BACK: [number, number, number, number] = [0.06, 0.05, 0.04, 1];
const LABEL_IDLE = "#E8D6A0"; // champagne
const LABEL_HOVER = "#FBECC2";
const FONT_SIZE = 13;

export function LiquidMetalButton({
  label = "Get Started",
  onClick,
  href,
  icon,
  viewMode = "text",
  height = 40,
  width,
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<
    Array<{ x: number; y: number; id: number }>
  >([]);
  const shaderRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: External library without types
  const shaderMount = useRef<any>(null);
  const buttonRef = useRef<HTMLElement>(null);
  const rippleId = useRef(0);

  const dimensions = useMemo(() => {
    if (viewMode === "icon") {
      const s = height;
      return { width: s, height: s, innerWidth: s - 4, innerHeight: s - 4, shaderWidth: s, shaderHeight: s };
    }

    // Measure the label so longer text (e.g. "Read the Docs") never clips.
    let measured = label.length * 7.5;
    if (typeof document !== "undefined") {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx) {
        ctx.font = `500 ${FONT_SIZE}px system-ui, -apple-system, sans-serif`;
        measured = ctx.measureText(label).width;
      }
    }
    const iconW = icon ? 22 : 0;
    const w = width ?? Math.ceil(measured + iconW + 38);
    return {
      width: w,
      height,
      innerWidth: w - 4,
      innerHeight: height - 4,
      shaderWidth: w,
      shaderHeight: height,
    };
  }, [viewMode, label, icon, width, height]);

  useEffect(() => {
    const styleId = "shader-canvas-style-exploded";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: 100px !important;
        }
        @keyframes ripple-animation {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const loadShader = async () => {
      try {
        if (shaderRef.current) {
          if (shaderMount.current?.destroy) {
            shaderMount.current.destroy();
          }

          shaderMount.current = new ShaderMount(
            shaderRef.current,
            liquidMetalFragmentShader,
            {
              u_colorBack: DARK_BACK,
              u_colorTint: GOLD_TINT,
              u_repetition: 4,
              u_softness: 0.5,
              u_shiftRed: 0.3,
              u_shiftBlue: 0.3,
              u_distortion: 0,
              u_contour: 0,
              u_angle: 45,
              u_scale: 8,
              u_shape: 1,
              u_offsetX: 0.1,
              u_offsetY: -0.1,
            },
            undefined,
            0.6,
          );
        }
      } catch (error) {
        console.error("[liquid-metal] Failed to load shader:", error);
      }
    };

    loadShader();

    return () => {
      if (shaderMount.current?.destroy) {
        shaderMount.current.destroy();
        shaderMount.current = null;
      }
    };
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
    shaderMount.current?.setSpeed?.(1);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    shaderMount.current?.setSpeed?.(0.6);
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (shaderMount.current?.setSpeed) {
      shaderMount.current.setSpeed(2.4);
      setTimeout(() => {
        shaderMount.current?.setSpeed?.(isHovered ? 1 : 0.6);
      }, 300);
    }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ripple = { x, y, id: rippleId.current++ };

      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
      }, 600);
    }

    onClick?.();
  };

  const labelColor = isHovered ? LABEL_HOVER : LABEL_IDLE;

  const interactiveStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: `${dimensions.width}px`,
    height: `${dimensions.height}px`,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    outline: "none",
    zIndex: 40,
    transformStyle: "preserve-3d",
    transform: "translateZ(25px)",
    overflow: "hidden",
    borderRadius: "100px",
    textDecoration: "none",
    display: "block",
  };

  const rippleNodes = ripples.map((ripple) => (
    <span
      key={ripple.id}
      style={{
        position: "absolute",
        left: `${ripple.x}px`,
        top: `${ripple.y}px`,
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        background:
          "radial-gradient(circle, rgba(232, 214, 160, 0.5) 0%, rgba(232, 214, 160, 0) 70%)",
        pointerEvents: "none",
        animation: "ripple-animation 0.6s ease-out",
      }}
    />
  ));

  return (
    <div className="relative inline-block">
      <div style={{ perspective: "1000px", perspectiveOrigin: "50% 50%" }}>
        <div
          style={{
            position: "relative",
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
            transformStyle: "preserve-3d",
            transition:
              "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
          }}
        >
          {/* Label / icon layer */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${dimensions.width}px`,
              height: `${dimensions.height}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "7px",
              transformStyle: "preserve-3d",
              transform: "translateZ(20px)",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            {viewMode === "icon" ? (
              <Sparkles
                size={16}
                style={{
                  color: labelColor,
                  filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.5))",
                }}
              />
            ) : (
              <>
                {icon && (
                  <span
                    style={{
                      display: "inline-flex",
                      color: labelColor,
                      filter: "drop-shadow(0px 1px 2px rgba(0,0,0,0.5))",
                      transition: "color 0.3s ease",
                    }}
                  >
                    {icon}
                  </span>
                )}
                <span
                  style={{
                    fontSize: `${FONT_SIZE}px`,
                    color: labelColor,
                    fontWeight: 500,
                    letterSpacing: "0.01em",
                    textShadow: "0px 1px 2px rgba(0, 0, 0, 0.6)",
                    transition: "color 0.3s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </div>

          {/* Inner dark pill */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${dimensions.width}px`,
              height: `${dimensions.height}px`,
              transformStyle: "preserve-3d",
              transform: `translateZ(10px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
              zIndex: 20,
              transition:
                "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                width: `${dimensions.innerWidth}px`,
                height: `${dimensions.innerHeight}px`,
                margin: "2px",
                borderRadius: "100px",
                // Frosted glass: translucent so the gold metal glints through, blurred.
                background:
                  "linear-gradient(180deg, rgba(28,26,20,0.45) 0%, rgba(0,0,0,0.4) 100%)",
                backdropFilter: "blur(9px)",
                WebkitBackdropFilter: "blur(9px)",
                boxShadow: isPressed
                  ? "inset 0px 2px 4px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(212,175,55,0.16)"
                  : "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(212,175,55,0.16)",
                transition: "box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>

          {/* Metal (shader) layer */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${dimensions.width}px`,
              height: `${dimensions.height}px`,
              transformStyle: "preserve-3d",
              transform: `translateZ(0px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
              zIndex: 10,
              transition: "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                height: `${dimensions.height}px`,
                width: `${dimensions.width}px`,
                borderRadius: "100px",
                boxShadow: isPressed
                  ? "0px 0px 0px 1px rgba(0,0,0,0.5), 0px 1px 2px 0px rgba(0,0,0,0.3)"
                  : isHovered
                    ? "0px 0px 0px 1px rgba(0,0,0,0.4), 0px 0px 22px 0px rgba(212,175,55,0.35), 0px 6px 14px 0px rgba(0,0,0,0.35)"
                    : "0px 0px 0px 1px rgba(0,0,0,0.35), 0px 0px 10px 0px rgba(212,175,55,0.12), 0px 8px 16px 0px rgba(0,0,0,0.3)",
                transition: "box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                background: "rgb(0 0 0 / 0)",
              }}
            >
              <div
                ref={shaderRef}
                className="shader-container-exploded"
                style={{
                  borderRadius: "100px",
                  overflow: "hidden",
                  position: "relative",
                  width: `${dimensions.shaderWidth}px`,
                  maxWidth: `${dimensions.shaderWidth}px`,
                  height: `${dimensions.shaderHeight}px`,
                }}
              />
            </div>
          </div>

          {/* Interactive layer — anchor when href is set, else button */}
          {href ? (
            <a
              ref={buttonRef as React.RefObject<HTMLAnchorElement>}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseDown={() => setIsPressed(true)}
              onMouseUp={() => setIsPressed(false)}
              style={interactiveStyle}
              aria-label={label}
            >
              {rippleNodes}
            </a>
          ) : (
            <button
              ref={buttonRef as React.RefObject<HTMLButtonElement>}
              type="button"
              onClick={handleClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseDown={() => setIsPressed(true)}
              onMouseUp={() => setIsPressed(false)}
              style={interactiveStyle}
              aria-label={label}
            >
              {rippleNodes}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
