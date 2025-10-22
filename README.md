# Realistic Spray Paint Web App

A high-performance, realistic spray paint simulator built with HTML5 Canvas and JavaScript. Features authentic spray paint physics, mist effects, and drip simulation.

## ✨ Features

- **Realistic Spray Physics** - Authentic aerosol can behavior with pressure sensitivity
- **Dynamic Mist Effects** - Directional overspray with variable density and size
- **Drip Simulation** - Sophisticated gravity-based paint drips
- **Zero-Gap Drawing** - Smooth continuous lines at any speed
- **Real-time Controls** - Adjust color, nozzle size, opacity, flow, and mist effects
- **60fps Performance** - Optimized for smooth real-time painting

## 🎨 Controls

| Control            | Range        | Description                 |
| ------------------ | ------------ | --------------------------- |
| **Color**          | Color picker | Choose spray paint color    |
| **Nozzle Size**    | 6-60px       | Spray width and intensity   |
| **Softness**       | 70-95%       | Edge softness of spray      |
| **Opacity**        | 80-100%      | Paint transparency          |
| **Flow**           | 80-120%      | Paint output rate           |
| **Drips**          | Toggle       | Enable/disable drip effects |
| **Scatter Radius** | 100-200%     | Mist spread distance        |
| **Scatter Amount** | 20-100%      | Mist particle density       |
| **Scatter Size**   | 50-150%      | Mist particle size          |

## ⌨️ Keyboard Shortcuts

- **1-9**: Quick nozzle size changes
- **Space**: Toggle drips on/off
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
   - Experiment with different mist effects

## 🛠️ Technical Details

- **Canvas API** - High-performance 2D rendering
- **Device Pixel Ratio** - Crisp graphics on all displays
- **Stamp Caching** - Optimized mist particle rendering
- **Grid-based Drips** - Efficient drip physics simulation
- **Real-time Controls** - Instant parameter adjustment

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
