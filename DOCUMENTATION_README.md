# Ca²⁺tch-One Documentation

## Available Documentation Files

This directory contains comprehensive documentation for the Ca²⁺tch-One calcium imaging analysis application.

### User Manual (Primary Documentation)

**📄 Ca2tchOne_User_Manual.pdf** - Complete user manual (163 KB, ~90 pages)
- Professional PDF format ready for distribution
- Fully formatted with tables, code blocks, and styling
- Print-ready A4 layout

**📝 USER_MANUAL.md** - Markdown source (57 KB)
- Same content as PDF in plain text format
- Easy to update and version control
- Convertible to other formats

### Quick Reference

**📋 MANUAL_SUMMARY.md** - Overview of manual contents
- Quick navigation guide
- Feature highlights
- Usage recommendations

**📖 README.md** - Original project README
- Basic getting started information
- Quick workflow overview
- System requirements

---

## Manual Contents Overview

### For New Users
Start here to learn the basics:
1. **Section 3:** Getting Started - Basic workflow
2. **Section 6:** Image Viewing & Display Controls
3. **Section 7:** ROI Detection - Understanding parameters
4. **Appendix C:** Complete workflow examples

### For Power Users
Deep-dive into advanced features:
- **Section 10:** Analysis Configuration (all parameters explained)
- **Section 11:** Running Analysis
- **Section 12:** Results & Metrics (comprehensive metric definitions)
- **Section 14:** Advanced Features

### For Troubleshooting
When things don't work as expected:
- **Section 15:** Troubleshooting (common issues and solutions)
- **Appendix A:** Parameter Quick Reference

### For Developers
Technical details and integration:
- **Section 16:** Technical Specifications
- Algorithm descriptions
- API endpoints
- System architecture

---

## How to Access the Manual

### View PDF
Open `Ca2tchOne_User_Manual.pdf` with any PDF reader:
```bash
# Linux
xdg-open Ca2tchOne_User_Manual.pdf

# macOS
open Ca2tchOne_User_Manual.pdf

# Windows
start Ca2tchOne_User_Manual.pdf
```

### View Markdown
Open `USER_MANUAL.md` in any text editor or markdown viewer:
```bash
# View in terminal with less
less USER_MANUAL.md

# View in browser (with markdown preview extension)
code USER_MANUAL.md  # VS Code
```

---

## Updating the Manual

If you need to update the documentation:

1. **Edit the Markdown source:**
   ```bash
   nano USER_MANUAL.md
   # or use your preferred editor
   ```

2. **Regenerate the PDF:**
   ```bash
   source backend/venv/bin/activate
   python convert_manual_to_pdf.py
   ```

The conversion script applies professional styling automatically.

---

## Manual Highlights

### Complete Parameter Documentation
Every parameter includes:
- Valid range and default value
- Clear explanation of effect
- Practical guidance on when to adjust
- Examples and warnings

### 20+ Reference Tables
Quick-lookup tables for:
- Detection parameters
- Analysis settings
- Colormap assignments
- Troubleshooting guides
- Technical specifications

### Step-by-Step Workflows
Three complete workflows with detailed steps:
1. **Basic GCaMP imaging** - Single channel analysis
2. **Fura-2 imaging** - Ratiometric calcium measurements
3. **Specialized assays** - TG leak and Ca²⁺ add-back

### Troubleshooting Section
Solutions for common issues:
- Detection problems (missing cells, false positives, merged ROIs)
- Analysis issues (negative ΔF/F₀, event detection failures)
- Technical problems (upload errors, memory limits, dimension mismatches)

---

## Documentation Statistics

- **Total Pages:** ~90 (A4 format)
- **Word Count:** ~35,000 words
- **Sections:** 16 main + 5 appendices
- **Tables:** 20+ reference tables
- **Code Examples:** 30+ blocks
- **Parameters Documented:** 30+ with full details

---

## Distribution

The PDF manual is ready for:
- ✓ User training sessions
- ✓ Software release documentation
- ✓ Academic publication supplements
- ✓ Customer support reference
- ✓ Internal documentation
- ✓ Professional printing

---

## Support

For questions about the application or documentation:
- Check the **Troubleshooting** section first
- Refer to the **Glossary** for term definitions
- Use the **Parameter Quick Reference** for rapid lookup

---

## Version Information

**Manual Version:** 1.0  
**Software Version:** v1.1.0-alpha  
**Last Updated:** April 2026  

The manual is current with the Ca²⁺tch-One v1.1.0-alpha release.

---

## License

Documentation follows the same license as the Ca²⁺tch-One software.

---

**End of Documentation README**
