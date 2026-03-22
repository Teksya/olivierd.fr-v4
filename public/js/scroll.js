  // Scroll indicators functionality
  const scrollContainer = document.getElementById('xp-scroll');
  const indicators = document.querySelectorAll('.scroll-indicator');
  
  let animationFrameId;
  let userInteracted = false;
  let lastTime = 0;
  let direction = 1; // 1 = forward, -1 = reverse
  
  // Update active indicator on scroll
  if(scrollContainer && indicators.length) {
    scrollContainer.addEventListener('scroll', () => {
      const scrollWidth = scrollContainer.scrollWidth - scrollContainer.clientWidth;
      const scrolled = scrollContainer.scrollLeft;
      const progress = scrollWidth > 0 ? scrolled / scrollWidth : 0;
      const activeIndex = Math.round(progress * (indicators.length - 1));
      indicators.forEach((ind, i) => {
        ind.classList.toggle('active', i === activeIndex);
      });
    });
    
    // Click indicators to scroll
    indicators.forEach((indicator, index) => {
      indicator.style.cursor = 'pointer';
      indicator.addEventListener('click', () => {
        userInteracted = true;
        cancelAnimationFrame(animationFrameId);
        const cardWidth = 288 + 16;
        scrollContainer.scrollTo({
          left: cardWidth * index,
          behavior: 'smooth'
        });
        setTimeout(() => {
          userInteracted = false;
          startAutoScroll();
        }, 5000);
      });
    });
    
    // Auto-scroll with requestAnimationFrame for smooth animation
    function autoScroll(currentTime) {
      if(!lastTime) lastTime = currentTime;
      const deltaTime = currentTime - lastTime;
      
      if(!userInteracted && deltaTime > 16) { // ~60fps
        const scrollWidth = scrollContainer.scrollWidth - scrollContainer.clientWidth;
        const currentScroll = scrollContainer.scrollLeft;
        
        // Change direction at edges with a small margin
        if(currentScroll >= scrollWidth - 2 && direction === 1) {
          direction = -1;
        } else if(currentScroll <= 2 && direction === -1) {
          direction = 1;
        }
        
        scrollContainer.scrollLeft += 0.5 * direction;
        lastTime = currentTime;
      } else if(!userInteracted) {
        lastTime = currentTime;
      }
      
      animationFrameId = requestAnimationFrame(autoScroll);
    }
    
    function startAutoScroll() {
      cancelAnimationFrame(animationFrameId);
      lastTime = 0;
      animationFrameId = requestAnimationFrame(autoScroll);
    }
    
    // Pause on hover
    scrollContainer.addEventListener('mouseenter', () => {
      userInteracted = true;
    });
    
    scrollContainer.addEventListener('mouseleave', () => {
      setTimeout(() => {
        userInteracted = false;
      }, 1000);
    });
    
    // Start auto-scroll
    startAutoScroll();
  }