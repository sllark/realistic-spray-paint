# Realistic Spray Paint Web App

A high-performance, realistic spray paint simulator built with HTML5 Canvas and JavaScript. Features authentic spray paint physics with granular noisy path effects, dynamic mist, and advanced drip simulation.

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
- **Advanced Drip Simulation** - Realistic paint drips with physics-based gravity, viscosity, and evaporation
- **HiDPI Support** - Crisp rendering on high-resolution displays with device pixel ratio awareness
- **Speed-Based Thickness** - Dynamic line thickness based on drawing speed for natural brush behavior
- **Stationary Dwell Effects** - Time-based overspray emission when holding the brush in place
- **Blue-Noise Scatter** - Golden-angle spiral distribution for natural, non-clumpy particle placement
- **Real-time Controls** - Comprehensive control panel for all spray and drip parameters
- **60fps Performance** - Optimized for smooth real-time painting with advanced caching

## 🎨 Controls

### **Spray Paint Controls**

| Control            | Range        | Default | Description                   |
| ------------------ | ------------ | ------- | ----------------------------- |
| **Color**          | Color picker | Black   | Choose spray paint color      |
| **Nozzle Size**    | 2-120px      | 25px    | Spray width and intensity     |
| **Softness**       | 70-95%       | 95%     | Edge softness of spray        |
| **Opacity**        | 80-100%      | 100%    | Paint transparency            |
| **Flow**           | 80-120%      | 100%    | Paint output rate             |
| **Scatter Radius** | 100-200%     | 150%    | Mist spread distance          |
| **Scatter Amount** | 20-100%      | 90%     | Mist particle density         |
| **Scatter Size**   | 50-150%      | 100%    | Mist particle size            |
| **Overspray**      | 0-100%       | 92%     | Excess paint beyond main area |
| **Distance**       | 6-50px       | 10px    | Spray distance from surface   |

### **Drip Simulation Controls**

| Control              | Range     | Default | Description                         |
| -------------------- | --------- | ------- | ----------------------------------- |
| **Drip Threshold**   | 10-65%    | 51%     | Paint accumulation needed for drips |
| **Drip Gravity**     | 500-3000  | 500     | How fast drips fall                 |
| **Drip Viscosity**   | 1.0-10.0  | 8.9     | Paint thickness/stickiness          |
| **Drip Evaporation** | 0.05-0.50 | 0.18    | How quickly paint evaporates        |
| **Toggle Drips**     | Button    | On      | Enable/disable drip simulation      |

## ⌨️ Keyboard Shortcuts

- **1-9**: Quick nozzle size changes
- **M**: Toggle scatter controls visibility
- **D**: Toggle drip controls visibility
- **Space**: Toggle drip simulation on/off
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
   - Hold the brush in place to create drips
   - Adjust drip parameters for different paint behaviors

## 🛠️ Technical Details

### **Core Rendering**

- **Canvas API** - High-performance 2D rendering with HiDPI support
- **Device Pixel Ratio** - Crisp graphics on all displays with automatic scaling
- **Granular Dots** - Individual dot rendering for noisy path effect
- **Brush Cache System** - Pre-rendered radial gradients with softness for realistic paint
- **Quarter-Pixel Caching** - Smooth brush transitions with efficient memory usage

### **Advanced Physics**

- **Log-Normal Distribution** - Box-Muller transform for realistic grain variation
- **Environmental Factors** - Distance and pressure affect grain size and opacity
- **Alpha Saturation** - Distance-aware opacity with plateau behavior for realistic paint buildup
- **Speed-Based Thickness** - Dynamic line thickness based on drawing speed
- **Stationary Dwell Effects** - Time-based overspray emission when holding brush in place

### **Drip Simulation**

- **Physics-Based Drips** - Realistic gravity, viscosity, and evaporation
- **Wetness Buffer** - 2D grid system for paint accumulation tracking
- **Drip Merging** - Intelligent merging of nearby drips to prevent multiple hairlines
- **Trail Rendering** - Dynamic trail width with cap-based limiting
- **Performance Optimization** - Efficient drip update loop with configurable limits

### **Particle Systems**

- **Blue-Noise Scatter** - Golden-angle spiral distribution for natural particle placement
- **Random Overspray System** - Log-normal size distribution with radius-based opacity falloff
- **Nozzle Area Scaling** - Dot density proportional to nozzle diameter squared
- **Circular Distribution** - Math.sqrt() for uniform circular spray patterns
- **Scatter Controls** - Real-time adjustment of mist effects

### **Performance Features**

- **60fps Optimization** - Efficient dot rendering and brush caching
- **Memory Management** - Automatic cache cleanup and size limits
- **Frame Rate Control** - Configurable update intervals for different performance needs
- **Debug Logging** - Comprehensive logging system for drip behavior analysis

## 💧 Drip Simulation

The app features a sophisticated drip simulation system that creates realistic paint drips based on physics:

### **How It Works**

1. **Paint Accumulation** - As you spray, paint accumulates in a 2D buffer
2. **Threshold Detection** - When enough paint pools in an area, a drip spawns
3. **Physics Simulation** - Drips fall under gravity with realistic viscosity
4. **Trail Rendering** - Each drip leaves a trail that widens as it falls
5. **Evaporation** - Paint gradually evaporates over time

### **Drip Controls**

- **Threshold** - How much paint accumulation triggers drips
- **Gravity** - How fast drips fall (higher = faster)
- **Viscosity** - How thick/sticky the paint is (higher = thicker)
- **Evaporation** - How quickly paint evaporates (higher = faster)

### **Tips for Realistic Drips**

- Hold the brush in one place to accumulate paint
- Use higher flow and pressure for more paint accumulation
- Adjust viscosity for different paint types (thick vs thin)
- Lower evaporation for longer-lasting drips

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
