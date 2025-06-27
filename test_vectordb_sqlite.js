const sqlite3 = require('sqlite3').verbose();
const OpenAI = require('openai');
require('dotenv').config();

// Set up OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function getEmbedding(text) {
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-ada-002",
            input: text,
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error('Error getting embedding:', error.message);
        return null;
    }
}

function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function testVectorDB() {
    const db = new sqlite3.Database('./data/chroma.sqlite3');
    
    console.log('Connected to ChromaDB SQLite database');
    
    // First, let's explore the database structure
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            console.error('Error getting tables:', err);
            return;
        }
        
        console.log('Available tables:', tables.map(t => t.name));
        
        // Get collections
        db.all("SELECT * FROM collections", async (err, collections) => {
            if (err) {
                console.error('Error getting collections:', err);
                return;
            }
            
            console.log('Collections:', collections);
            
            if (collections.length === 0) {
                console.log('No collections found');
                db.close();
                return;
            }
            
            console.log(`\nQuerying collection: ${collections[0].name}`);
            
            // Get embeddings and join with metadata for documents
            const query = `
                SELECT 
                    e.id,
                    e.embedding_id,
                    doc.string_value as document,
                    file.string_value as file_path,
                    func.string_value as function_name,
                    lang.string_value as language
                FROM embeddings e
                LEFT JOIN embedding_metadata doc ON e.id = doc.id AND doc.key = 'chroma:document'
                LEFT JOIN embedding_metadata file ON e.id = file.id AND file.key = 'file_path'
                LEFT JOIN embedding_metadata func ON e.id = func.id AND func.key = 'function_name' 
                LEFT JOIN embedding_metadata lang ON e.id = lang.id AND lang.key = 'language'
                LIMIT 100
            `;
            
            db.all(query, async (err, embeddings) => {
                if (err) {
                    console.error('Error getting embeddings:', err);
                    db.close();
                    return;
                }
                
                console.log(`Found ${embeddings.length} embeddings in the collection`);
                
                if (embeddings.length === 0) {
                    console.log('No embeddings found');
                    db.close();
                    return;
                }
                
                // Show first few embeddings
                console.log('\nFirst few embeddings:');
                embeddings.slice(0, 5).forEach((emb, i) => {
                    console.log(`${i + 1}. ID: ${emb.id}`);
                    console.log(`   File: ${emb.file_path || 'N/A'}`);
                    console.log(`   Function: ${emb.function_name || 'N/A'}`);
                    console.log(`   Language: ${emb.language || 'N/A'}`);
                    if (emb.document) {
                        console.log(`   Document: ${emb.document.substring(0, 150)}...`);
                    }
                    console.log('');
                });
                
                // Search for best matches for "index" since no "home page" found
                console.log('\n=== DETAILED SEARCH FOR "index" ===');
                const indexMatches = embeddings.filter(emb => 
                    emb.document && emb.document.toLowerCase().includes('index')
                );
                
                console.log(`Found ${indexMatches.length} documents containing "index"`);
                
                // Show detailed results for index matches
                indexMatches.forEach((match, i) => {
                    console.log(`\n--- Index Match ${i + 1} ---`);
                    console.log(`ID: ${match.id}`);
                    console.log(`File: ${match.file_path || 'N/A'}`);
                    console.log(`Function: ${match.function_name || 'N/A'}`);
                    console.log(`Language: ${match.language || 'N/A'}`);
                    if (match.document) {
                        const doc = match.document;
                        const searchTerm = 'index';
                        const index = doc.toLowerCase().indexOf(searchTerm);
                        const start = Math.max(0, index - 100);
                        const end = Math.min(doc.length, index + 200);
                        console.log(`Full Context: ${doc.substring(start, end)}`);
                    }
                    console.log('');
                });
                
                // Also search for other potentially relevant terms
                console.log('\n=== OTHER RELEVANT SEARCHES ===');
                const relevantTerms = ['main', 'home', 'landing', 'route', 'component'];
                
                for (const term of relevantTerms) {
                    const matches = embeddings.filter(emb => 
                        emb.document && emb.document.toLowerCase().includes(term)
                    );
                    if (matches.length > 0) {
                        console.log(`\n"${term}": ${matches.length} matches`);
                        matches.slice(0, 3).forEach(match => {
                            console.log(`  - ${match.file_path || 'N/A'}`);
                            if (match.document) {
                                const doc = match.document;
                                const index = doc.toLowerCase().indexOf(term);
                                const start = Math.max(0, index - 30);
                                const end = Math.min(doc.length, index + 50);
                                console.log(`    Context: ...${doc.substring(start, end)}...`);
                            }
                        });
                    }
                }
                
                db.close();
                console.log('\n=== Vector search completed ===');
            });
        });
    });
}

// Run the test
testVectorDB().catch(console.error);