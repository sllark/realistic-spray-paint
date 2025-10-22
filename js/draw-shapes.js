class ShapeDrawer {
  constructor(sprayPaint) {
    this.sprayPaint = sprayPaint;
    this.isDrawingShape = false;
    this.shapeStartX = 0;
    this.shapeStartY = 0;
    this.currentShape = null;
  }

  // Draw a circle using spray paint
  drawCircle(centerX, centerY, radius, density = 1.0) {
    const circumference = 2 * Math.PI * radius;
    const numPoints = Math.max(20, Math.floor(circumference * density));

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      this.sprayPaint.stamp(x, y);
    }
  }

  // Draw a filled circle using spray paint
  drawFilledCircle(centerX, centerY, radius, density = 1.0) {
    const numRings = Math.max(3, Math.floor(radius / 5));

    for (let ring = 0; ring < numRings; ring++) {
      const ringRadius = (ring / numRings) * radius;
      this.drawCircle(centerX, centerY, ringRadius, density);
    }
  }

  // Draw a line using spray paint
  drawLine(startX, startY, endX, endY, density = 1.0) {
    const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    const numPoints = Math.max(10, Math.floor(distance * density));

    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t;

      this.sprayPaint.stamp(x, y);
    }
  }

  // Draw a rectangle using spray paint
  drawRectangle(x, y, width, height, density = 1.0) {
    const points = [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
      [x, y],
    ];

    for (let i = 0; i < points.length - 1; i++) {
      this.drawLine(
        points[i][0],
        points[i][1],
        points[i + 1][0],
        points[i + 1][1],
        density
      );
    }
  }

  // Draw a filled rectangle using spray paint
  drawFilledRectangle(x, y, width, height, density = 1.0) {
    const stepSize = Math.max(2, Math.floor(5 / density));

    for (let i = 0; i < width; i += stepSize) {
      for (let j = 0; j < height; j += stepSize) {
        const stampX = x + i + (Math.random() - 0.5) * 2;
        const stampY = y + j + (Math.random() - 0.5) * 2;

        if (Math.random() < density) {
          this.sprayPaint.stamp(stampX, stampY);
        }
      }
    }
  }

  // Draw text using spray paint
  drawText(text, x, y, fontSize = 24, fontFamily = "Arial") {
    // Create a temporary canvas to measure text
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.font = `${fontSize}px ${fontFamily}`;

    const metrics = tempCtx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;

    // Create text outline using spray paint
    const stepSize = Math.max(1, Math.floor(fontSize / 20));

    for (let i = 0; i < textWidth; i += stepSize) {
      for (let j = 0; j < textHeight; j += stepSize) {
        const testX = x + i;
        const testY = y + j;

        // Simple text rendering - in a real implementation,
        // you'd use more sophisticated text rendering
        if (this.isPointInText(testX, testY, text, x, y, fontSize)) {
          this.sprayPaint.stamp(testX, testY);
        }
      }
    }
  }

  // Simple text point-in-shape test (simplified)
  isPointInText(x, y, text, startX, startY, fontSize) {
    // This is a simplified implementation
    // In a real app, you'd use proper text rendering
    const charWidth = fontSize * 0.6;
    const charIndex = Math.floor((x - startX) / charWidth);

    if (charIndex >= 0 && charIndex < text.length) {
      const char = text[charIndex];
      const charX = startX + charIndex * charWidth;
      const charY = startY;

      // Simple character shape detection
      return this.isPointInCharacter(x - charX, y - charY, char, fontSize);
    }

    return false;
  }

  // Simple character shape detection (simplified)
  isPointInCharacter(relX, relY, char, fontSize) {
    const normalizedX = relX / fontSize;
    const normalizedY = relY / fontSize;

    // Very simplified character shapes
    switch (char.toLowerCase()) {
      case "a":
        return (
          normalizedY > 0.2 &&
          normalizedY < 0.8 &&
          normalizedX > 0.1 &&
          normalizedX < 0.9 &&
          !(
            normalizedY > 0.4 &&
            normalizedY < 0.6 &&
            normalizedX > 0.3 &&
            normalizedX < 0.7
          )
        );
      case "b":
        return (
          normalizedX > 0.1 &&
          normalizedX < 0.9 &&
          normalizedY > 0.1 &&
          normalizedY < 0.9
        );
      case "c":
        return (
          normalizedX > 0.2 &&
          normalizedX < 0.8 &&
          normalizedY > 0.2 &&
          normalizedY < 0.8 &&
          !(
            normalizedX > 0.4 &&
            normalizedX < 0.8 &&
            normalizedY > 0.3 &&
            normalizedY < 0.7
          )
        );
      default:
        // Default rectangular shape
        return (
          normalizedX > 0.1 &&
          normalizedX < 0.9 &&
          normalizedY > 0.1 &&
          normalizedY < 0.9
        );
    }
  }

  // Draw a star using spray paint
  drawStar(centerX, centerY, outerRadius, innerRadius, numPoints = 5) {
    const angleStep = (Math.PI * 2) / (numPoints * 2);

    for (let i = 0; i < numPoints * 2; i++) {
      const angle = i * angleStep;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      this.sprayPaint.stamp(x, y);
    }
  }

  // Draw a heart shape using spray paint
  drawHeart(centerX, centerY, size) {
    const numPoints = 50;

    for (let i = 0; i < numPoints; i++) {
      const t = (i / numPoints) * Math.PI * 2;
      const x = centerX + 16 * Math.pow(Math.sin(t), 3) * size;
      const y =
        centerY -
        (13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t)) *
          size;

      this.sprayPaint.stamp(x, y);
    }
  }

  // Draw a spiral using spray paint
  drawSpiral(centerX, centerY, maxRadius, turns = 3, density = 1.0) {
    const numPoints = Math.max(50, Math.floor(maxRadius * turns * density));

    for (let i = 0; i < numPoints; i++) {
      const t = (i / numPoints) * turns * Math.PI * 2;
      const radius = (i / numPoints) * maxRadius;
      const x = centerX + Math.cos(t) * radius;
      const y = centerY + Math.sin(t) * radius;

      this.sprayPaint.stamp(x, y);
    }
  }

  // Draw a grid pattern using spray paint
  drawGrid(startX, startY, width, height, gridSize, density = 1.0) {
    const numCols = Math.floor(width / gridSize);
    const numRows = Math.floor(height / gridSize);

    // Draw vertical lines
    for (let col = 0; col <= numCols; col++) {
      const x = startX + col * gridSize;
      this.drawLine(x, startY, x, startY + height, density);
    }

    // Draw horizontal lines
    for (let row = 0; row <= numRows; row++) {
      const y = startY + row * gridSize;
      this.drawLine(startX, y, startX + width, y, density);
    }
  }

  // Draw a mandala pattern using spray paint
  drawMandala(centerX, centerY, radius, numRays = 12, density = 1.0) {
    const angleStep = (Math.PI * 2) / numRays;

    for (let ray = 0; ray < numRays; ray++) {
      const angle = ray * angleStep;
      const endX = centerX + Math.cos(angle) * radius;
      const endY = centerY + Math.sin(angle) * radius;

      this.drawLine(centerX, centerY, endX, endY, density);
    }

    // Draw concentric circles
    const numCircles = Math.floor(radius / 20);
    for (let i = 1; i <= numCircles; i++) {
      const circleRadius = (i / numCircles) * radius;
      this.drawCircle(centerX, centerY, circleRadius, density);
    }
  }
}
