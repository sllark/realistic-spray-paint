# Realistic Spray Paint Web App

A high-performance, realistic spray paint simulator built with HTML5 Canvas and JavaScript. Features authentic spray paint physics with granular noisy path effects and dynamic mist.

## ✨ Features

- **Granular Noisy Path** - Individual dots create realistic spray texture with gaps on first pass, solid coverage on multiple passes
- **Real Distance Physics** - Nozzle-to-cone mapping with distance-based intensity falloff and plume radius calculation
- **Area-Based Density** - Dot count scales with nozzle area (diameter²) for realistic coverage
- **Saturation Plateau** - Opacity builds quickly then plateaus, mimicking real paint buildup behavior
- **Gaussian Softness** - Pre-rendered radial brush cache with real softness gradients instead of hard circles
- **Sophisticated Grain Control** - Log-normal distribution with environmental factors (distance, pressure) for ultra-realistic texture
- **Dynamic Mist Effects** - Directional overspray with variable density and size
- **Random Airy Overspray** - Log-normal size distribution with radius-based opacity falloff and additive blending for realistic mist
- **Circular Distribution** - Proper circular spray patterns instead of square
- **Zero-Gap Drawing** - Smooth continuous lines at any speed
- **Real-time Controls** - Adjust color, nozzle size, opacity, flow, scatter effects, and overspray
- **60fps Performance** - Optimized for smooth real-time painting

## 🎨 Controls

| Control            | Range        | Default | Description                   |
| ------------------ | ------------ | ------- | ----------------------------- |
| **Color**          | Color picker | Black   | Choose spray paint color      |
| **Nozzle Size**    | 2-120px      | 80px    | Spray width and intensity     |
| **Softness**       | 70-95%       | 95%     | Edge softness of spray        |
| **Opacity**        | 80-100%      | 100%    | Paint transparency            |
| **Flow**           | 80-120%      | 110%    | Paint output rate             |
| **Scatter Radius** | 100-200%     | 120%    | Mist spread distance          |
| **Scatter Amount** | 20-100%      | 100%    | Mist particle density         |
| **Scatter Size**   | 50-150%      | 150%    | Mist particle size            |
| **Overspray**      | 0-100%       | 30%     | Excess paint beyond main area |
| **Distance**       | 6-50px       | 12px    | Spray distance from surface   |

## ⌨️ Keyboard Shortcuts

- **1-9**: Quick nozzle size changes
- **M**: Toggle scatter controls visibility
- **Ctrl/Cmd + S**: Export as PNG
- **Ctrl/Cmd + Z**: Clear canvas

## 🚀 Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/realistic-spray-paint.git
   cd realistic-spray-paint
   ```

2. **Open in browser**

   ```bash
   # Simply open index.html in any modern browser
   open index.html
   ```

3. **Start painting!**
   - Click and drag to spray paint
   - Use the control panel to adjust settings
   - Experiment with different scatter effects
   - Multiple passes create solid coverage from noisy paths

## 🛠️ Technical Details

- **Canvas API** - High-performance 2D rendering
- **Device Pixel Ratio** - Crisp graphics on all displays
- **Granular Dots** - Individual dot rendering for noisy path effect
- **Brush Cache System** - Pre-rendered radial gradients with softness for realistic paint
- **Log-Normal Distribution** - Box-Muller transform for realistic grain variation
- **Environmental Factors** - Distance and pressure affect grain size and opacity
- **Alpha Saturation** - Distance-aware opacity with plateau behavior for realistic paint buildup
- **Random Overspray System** - Log-normal size distribution, radius-based opacity falloff, and additive blending for realistic mist
- **Nozzle Area Scaling** - Dot density proportional to nozzle diameter squared for realistic coverage
- **Circular Distribution** - Math.sqrt() for uniform circular spray patterns
- **Scatter Controls** - Real-time adjustment of mist effects
- **Performance Optimization** - 60fps with efficient dot rendering and brush caching

## 📁 Project Structure

```
├── index.html          # Main HTML file
├── styles.css          # UI styling
├── js/
│   ├── main.js         # App controller
│   ├── spray.js        # Core spray paint logic
│   ├── drawer-canvas.js # Canvas management
│   └── draw-shapes.js  # Shape drawing utilities
└── README.md           # This file
```

## 🎯 Browser Support

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## 📄 License

MIT License - Feel free to use in your projects!

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

---

**Made with ❤️ for digital artists and spray paint enthusiasts**
