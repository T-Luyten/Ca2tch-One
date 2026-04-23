#!/usr/bin/env python3
"""Convert the Ca2+tch-One User Manual from Markdown to PDF"""

import markdown
from weasyprint import HTML, CSS
from pathlib import Path

# Read the markdown file
md_file = Path(__file__).parent / "USER_MANUAL.md"
pdf_file = Path(__file__).parent / "Ca2tchOne_User_Manual.pdf"

with open(md_file, 'r', encoding='utf-8') as f:
    md_content = f.read()

# Convert markdown to HTML with extensions
html_content = markdown.markdown(
    md_content,
    extensions=[
        'markdown.extensions.tables',
        'markdown.extensions.fenced_code',
        'markdown.extensions.codehilite',
        'markdown.extensions.toc',
        'markdown.extensions.sane_lists',
    ]
)

# Create styled HTML document
styled_html = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Ca²⁺tch-One User Manual</title>
    <style>
        @page {{
            size: A4;
            margin: 2.5cm 2cm;
            @top-center {{
                content: "Ca²⁺tch-One User Manual";
                font-size: 10pt;
                color: #666;
            }}
            @bottom-right {{
                content: "Page " counter(page) " of " counter(pages);
                font-size: 9pt;
                color: #666;
            }}
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.6;
            color: #333;
            max-width: 100%;
        }}
        
        h1 {{
            font-size: 24pt;
            color: #1a1a1a;
            border-bottom: 3px solid #3b82f6;
            padding-bottom: 0.3em;
            margin-top: 1.5em;
            margin-bottom: 0.8em;
            page-break-after: avoid;
        }}
        
        h2 {{
            font-size: 18pt;
            color: #2563eb;
            margin-top: 1.2em;
            margin-bottom: 0.6em;
            page-break-after: avoid;
        }}
        
        h3 {{
            font-size: 14pt;
            color: #1e40af;
            margin-top: 1em;
            margin-bottom: 0.5em;
            page-break-after: avoid;
        }}
        
        h4 {{
            font-size: 12pt;
            color: #1e3a8a;
            margin-top: 0.8em;
            margin-bottom: 0.4em;
        }}
        
        p {{
            margin: 0.5em 0;
            text-align: justify;
        }}
        
        code {{
            background-color: #f3f4f6;
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-family: "Courier New", Courier, monospace;
            font-size: 9pt;
            color: #dc2626;
        }}
        
        pre {{
            background-color: #1f2937;
            color: #f9fafb;
            padding: 1em;
            border-radius: 5px;
            overflow-x: auto;
            margin: 1em 0;
            page-break-inside: avoid;
        }}
        
        pre code {{
            background-color: transparent;
            color: inherit;
            padding: 0;
        }}
        
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
            font-size: 9pt;
            page-break-inside: avoid;
        }}
        
        th {{
            background-color: #3b82f6;
            color: white;
            padding: 0.6em;
            text-align: left;
            font-weight: 600;
        }}
        
        td {{
            border: 1px solid #d1d5db;
            padding: 0.5em;
        }}
        
        tr:nth-child(even) {{
            background-color: #f9fafb;
        }}
        
        ul, ol {{
            margin: 0.5em 0;
            padding-left: 2em;
        }}
        
        li {{
            margin: 0.3em 0;
        }}
        
        blockquote {{
            border-left: 4px solid #3b82f6;
            margin: 1em 0;
            padding: 0.5em 1em;
            background-color: #eff6ff;
            font-style: italic;
        }}
        
        strong {{
            font-weight: 600;
            color: #1f2937;
        }}
        
        em {{
            font-style: italic;
            color: #4b5563;
        }}
        
        hr {{
            border: none;
            border-top: 2px solid #e5e7eb;
            margin: 2em 0;
        }}
        
        a {{
            color: #2563eb;
            text-decoration: none;
        }}
        
        /* Special formatting for warnings and notes */
        p:has(> strong:first-child) {{
            padding: 0.8em;
            border-radius: 5px;
            margin: 1em 0;
        }}
        
        /* Prevent awkward page breaks */
        h1, h2, h3, h4, h5, h6 {{
            page-break-after: avoid;
        }}
        
        table, figure, pre {{
            page-break-inside: avoid;
        }}
        
        /* First page title styling */
        h1:first-of-type {{
            font-size: 32pt;
            text-align: center;
            color: #1e3a8a;
            margin-top: 2em;
            margin-bottom: 0.5em;
            border-bottom: none;
        }}
        
        h2:nth-of-type(1) {{
            text-align: center;
            font-size: 16pt;
            color: #3b82f6;
            margin-bottom: 2em;
        }}
    </style>
</head>
<body>
{html_content}
</body>
</html>
"""

# Convert HTML to PDF
print("Converting markdown to PDF...")
HTML(string=styled_html).write_pdf(pdf_file)

print(f"✓ PDF created successfully: {pdf_file}")
print(f"  File size: {pdf_file.stat().st_size / 1024 / 1024:.2f} MB")
