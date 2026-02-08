# Helios - Professional eVTOL Drone Application

A modern, cross-platform desktop and web application for professional drone fleet management and eVTOL operations.

## Features

- **Cross-Platform**: Runs on macOS, Windows, and web browsers
- **Professional Design**: Liquid glass UI with light/dark theme support
- **3D Visualization**: Embedded Sketchfab drone model as the main background
- **Navigation**: Pill-shaped vertical menu with tooltips
- **Dashboard**: Action pills for Support, Documentation, Connect, and Join
- **Responsive**: Adapts to different screen sizes

## Technology Stack

- **Electron**: Cross-platform desktop app framework
- **HTML5/CSS3**: Modern web technologies with custom design system
- **JavaScript**: Vanilla JS for interactivity
- **Sketchfab**: 3D model embedding

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/see-k/helios-app.git
cd helios-app

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build:mac    # macOS
npm run build:win    # Windows
```

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.js     # App entry point
│   └── preload.js  # Context bridge
└── renderer/       # UI layer
    ├── index.html  # Main page
    ├── css/        # Stylesheets
    │   ├── theme.css     # Theme variables
    │   ├── layout.css    # Layout & structure
    │   ├── glass.css     # Glass morphism effects
    │   ├── nav.css       # Navigation styles
    │   ├── dashboard.css # Dashboard components
    │   └── animations.css # Animations
    └── js/
        └── app.js        # Application logic
```

## Design System

### Liquid Glass Theme

The app uses a sophisticated glass morphism design system with:

- **Backdrop blur** effects
- **Subtle gradients** and shadows
- **Smooth animations** and transitions
- **Light/dark mode** support
- **Professional color palette**

### Components

- **Navigation Pills**: Icon-based vertical menu with hover tooltips
- **Action Cards**: Interactive dashboard elements with glass effects
- **Theme Toggle**: Sun/moon icon in titlebar
- **Custom Titlebar**: Native macOS-style window controls

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on multiple platforms
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Author

Helios Team