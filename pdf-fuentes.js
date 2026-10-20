// PDFs del servidor con la tipografía de la casa (Jost) en lugar de Helvetica.
// Se sustituyen los nombres estándar, así no hay que tocar cada .font('Helvetica…').
'use strict';
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const DIR = path.join(__dirname, 'fonts', 'ttf');
const MAPA = {
  'Helvetica': 'Jost_300Light.ttf',
  'Helvetica-Bold': 'Jost_500Medium.ttf',
  'Helvetica-Oblique': 'Jost_300Light_Italic.ttf',
  'Helvetica-BoldOblique': 'Jost_500Medium.ttf',
  'Times-Roman': 'Jost_300Light.ttf',
  'Times-Bold': 'Jost_500Medium.ttf',
  'Times-Italic': 'Jost_300Light_Italic.ttf'
};
const disponibles = Object.keys(MAPA).filter(n => fs.existsSync(path.join(DIR, MAPA[n])));

class PDFDonFadrique extends PDFDocument {
  constructor(opts) {
    super(opts);
    try {
      disponibles.forEach(n => { this.registerFont(n, path.join(DIR, MAPA[n])); if (this._fontFamilies) delete this._fontFamilies[n]; });
      this.font('Helvetica');
    } catch (e) { /* si falla, se queda con Helvetica */ }
  }
}
module.exports = PDFDonFadrique;
