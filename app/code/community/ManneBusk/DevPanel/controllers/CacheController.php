<?php
/**
 * Layout Controller
 *
 * @category   ManneBusk
 * @package    ManneBusk_DevPanel
 * @author     Manne Busk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_CacheController extends Mage_Core_Controller_Front_Action
{
    /**
     * Clear cache action
     *
     * @access public
     * @return $this
     */
    public function clearAction()
    {
        Mage::app()->cleanCache();
        $this->loadLayout();
        $output = $this->getLayout()->createBlock('devpanel/ajax_output', 'ajaxMessage');
        $msg    = $this->_getRandomChuckNorrisCacheCleaningMessage();
        $output->setMessage($msg);

        Mage::app()->getResponse()
            ->setHeader('Content-Type', 'application/json', true)
            ->setBody($output->getJSON())
            ->sendResponse();

        exit;
    }

    /**
     * Get random Chuck Norris cache cleaning phrase
     *
     * @return string
     */
    protected function _getRandomChuckNorrisCacheCleaningMessage()
    {
        $chuck = array(
            'Chuck Norris threw a grenade and killed all cache files, then it exploded.',
            'Chuck Norris has strangled the cache with a cordless phone.',
            'Chuck Norris counted to infinity. Twice.  ... and also your cache is cleaned.',
            'What was going through the minds of all of all cache files before they died? Chuck Norris shoe.',
        );
        return $chuck[rand(0, (count($chuck) - 1))];
    }
}
